'use strict';

// based on the original work done by the AWSLabs team:
// https://github.com/awslabs/service-discovery-ecs-dns/blob/master/lambda_health_check.py

const AWS = require('aws-sdk');
const dns = require('dns');

AWS.config.apiVersions = {
  iam: '2010-05-08',
  ec2: '2016-11-15',
  ecs: '2014-11-13',
  route53: '2013-04-01'
};

const ROUTE53_ZONE = 'servicediscovery.internal.';

class EcsSdHealth {

  static handler(event, context, callback) {
    console.log('starting handler');

    new EcsSdHealth()
      .start(event, context)
      .then((results) => {
        callback(null, results);
      })
      .catch((err) => {
        console.log('Error during health check');
        console.log(err);
        callback(err, null);
      });
  }

  constructor() {
    this.zoneId = 'INVALID';
    this.ec2 = new AWS.EC2();
    this.ecs = new AWS.ECS();
    this.route53 = new AWS.Route53();
  }

  start(event, context) {
    return new Promise((resolve, reject) => {
      this
        .getClusterList()
        .then(this.getContainerInstanceArns.bind(this))
        .then(this.getContainerInstanceDescriptions.bind(this))
        .then(this.getEc2Instance.bind(this))
        .then(this.getTasks.bind(this))
        .then(this.getTaskDefinitions.bind(this))
        .then(this.getRoute53Entries.bind(this))
        .then(this.processZone.bind(this))
        .then(this.purgeInvalidEntries.bind(this))
        .then(resolve)
        .catch(reject);
    });
  }

  //////////// (functions in order of calls in this.start)

  getClusterList() {
    return new Promise((resolve, reject) => {
      let params = {};

      this
        .ecs
        .listClusters(params, (err, data) => {
          /***
           * http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/ECS.html#listClusters-property
           data = {
              clusterArns: [
                "arn:aws:ecs:us-east-1:<aws_account_id>:cluster/test",
                "arn:aws:ecs:us-east-1:<aws_account_id>:cluster/default"
              ]
            }
           */
          if (err) {
            return reject(err);
          }

          if (!data || !data.clusterArns || data.clusterArns.length === 0) {
            return reject(new Error('No clusters found - cannot continue'));
          }
          resolve(data.clusterArns);
        });
    });
  }

  getContainerInstanceArns(ecsClusterArns) {
    return new Promise((resolve, reject) => {
      let wait = [];

      for (let clusterArn of ecsClusterArns) {
        wait
          .push(new Promise((res, rej) => {
            let param = {
              cluster: clusterArn
            };

            this
              .ecs
              .listContainerInstances(param, (err, data) => {
                if (err) {
                  return rej(err);
                }

                if (!data || !data.containerInstanceArns || data.containerInstanceArns.length === 0) {
                  console.log(`warning: unable to find containerInstanceArns for ECS Cluster: ${clusterArn}`);
                }

                res(data.containerInstanceArns);
              });
          }));
      }

      Promise
        .all(wait)
        .then((results) => {

          let containerInstanceArns = [];
          for (let result of results) {
            containerInstanceArns.push.apply(containerInstanceArns, result);
          }

          resolve(containerInstanceArns);
        })
        .catch(reject);
    });
  }

  getContainerInstanceDescriptions(containerInstanceArns) {
    return new Promise((resolve, reject) => {
      let params = {
        containerInstances: containerInstanceArns
      };

      this
        .ecs
        .describeContainerInstances(params, (err, data) => {
          if (err) {
            return reject(err);
          }

          let ec2InstanceMap = {};
          let instanceArnMap = {};
          for (let instanceDescription of data.containerInstances) {
            ec2InstanceMap[instanceDescription.ec2InstanceId] = {
              instanceArn: instanceDescription.containerInstanceArn
            };
            instanceArnMap[instanceDescription.containerInstanceArn] = {
              instanceId: instanceDescription.ec2InstanceId
            }
          }

          resolve({
            ec2InstanceMap: ec2InstanceMap,
            instanceArnMap: instanceArnMap
          });
        });
    });
  }

  getEc2Instance(state) {
    return new Promise((resolve, reject) => {
      if (Object.keys(state.ec2InstanceMap).length === 0) {
        return resolve(state);
      }

      let params = {
        InstanceIds: Object.keys(state.ec2InstanceMap)
      };

      this
        .ec2
        .describeInstances(params, (err, data) => {
          if (err) {
            return reject(err);
          }

          for (let reservation of data.Reservations) {
            for (let instance of reservation.Instances) {
              state.ec2InstanceMap[instance.InstanceId].privateIP = instance.PrivateIpAddress;
            }
          }

          resolve(state);
        });
    });
  }

  getTasks(state) {
    return new Promise((resolve, reject) => {
      let params = {
        desiredStatus: 'RUNNING'
      };

      // http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/ECS.html#listTasks-property
      this
        .ecs
        .listTasks(params, (err, data) => {
          if (err) {
            return reject(err);
          }


          state.tasks = {};
          if (data.taskArns.length === 0) {
            return resolve(state);
          }

          let params = {
            tasks: data.taskArns
          };

          this
            .ecs
            .describeTasks(params, (err, data) => {
              if (err) {
                return reject(err);
              }

              for (let taskDescription of data.tasks) {
                state.tasks[taskDescription.taskArn] = {
                  instance: taskDescription.containerInstanceArn,
                  taskDefinitionArn: taskDescription.taskDefinitionArn,
                  containers: [],
                  taskDesc: {
                    containers: taskDescription.containers
                  }
                }
              }

              resolve(state);
            });
        });
    });
  }

  getTaskDefinitions(state) {
    return new Promise((resolve, reject) => {
      let wait = [];
      let taskDefinitionCache = {};

      for (let taskArn of Object.keys(state.tasks)) {
        let task = state.tasks[taskArn];

        let cache = taskDefinitionCache[task.taskDefinitionArn];

        wait
          .push(new Promise((res, rej) => {
            if (!cache) {
              taskDefinitionCache[task.taskDefinitionArn] = {data: null};


              let params = {
                taskDefinition: task.taskDefinitionArn
              };

              this
                .ecs
                .describeTaskDefinition(params, (err, data) => {
                  if (err) {
                    return rej(err);
                  }

                  taskDefinitionCache[task.taskDefinitionArn].data = data.taskDefinition;
                  res(taskDefinitionCache[task.taskDefinitionArn]);
                });
            } else {
              res(taskDefinitionCache[task.taskDefinitionArn]);
            }
          }));
      }

      Promise
        .all(wait)
        .then((results) => {
          let taskDefinitionMap = {};
          for (let taskDefinition of results) {
            taskDefinition = taskDefinition.data;

            if (taskDefinitionMap[taskDefinition.taskDefinitionArn]) {
              continue;
            }

            taskDefinitionMap[taskDefinition.taskDefinitionArn] = taskDefinition;

            taskDefinition.services = [];

            for (let container of taskDefinition.containerDefinitions) {
              for (let env of container.environment) {
                let envParts = env.name.split('_');
                if (envParts.length === 3 && envParts[0] === 'SERVICE' && envParts[2] === 'NAME') {
                  taskDefinition.services.push(env)
                }
              }
            }
          }

          for (let taskArn of Object.keys(state.tasks)) {
            let task = state.tasks[taskArn];
            let taskDefinition = taskDefinitionMap[task.taskDefinitionArn];

            for (let service of taskDefinition.services) {
              let serviceParts = service.name.split('_');

              let port = 0;
              for (let container of task.taskDesc.containers) {
                for (let network of container.networkBindings) {
                  if (`${network.containerPort}` === serviceParts[1]) {
                    port = network.hostPort;
                  }
                }
              }

              task.containers.push({
                service: service.value,
                port: port
              });
            }
          }
          resolve(state);
        })
        .catch(reject);
    });
  }

  getRoute53Entries(state) {
    return new Promise((resolve, reject) => {
      let zoneParams = {
        DNSName: ROUTE53_ZONE,
        MaxItems: '1'
      };

      this
        .route53
        .listHostedZonesByName(zoneParams, (err, zone) => {
          if (err) {
            return reject(err);
          }

          if (!zone || !zone.HostedZones || zone.HostedZones.length === 0) {
            return reject(new Error(`Unable to get Zone details for ${ROUTE53_ZONE} -- cannot continue`));
          }

          this.zoneId = zone.HostedZones[0].Id;
          let params = {
            HostedZoneId: zone.HostedZones[0].Id
          };

          this
            .route53
            .listResourceRecordSets(params, (err, data) => {
              if (err) {
                return reject(err);
              }

              if (!data || !data.ResourceRecordSets) {
                return reject(new Error('Unable to get ResourceRecordSets'));
              }

              state.dnsEntries = (data || {}).ResourceRecordSets || [];
              resolve(state);
            });
        });
    });
  }

  processZone(state) {
    return new Promise((resolve, reject) => {

      let dnsRecords = [];
      for (let dnsRecord of state.dnsEntries) {
        if (dnsRecord['Type'] !== 'SRV') {
          continue;
        }
        dnsRecords.push(dnsRecord);
      }

      let wait = [];
      for (let dnsRecord of dnsRecords) {
        wait
          .push(new Promise((res, rej) => {

            let innerWait = [];
            for (let resourceRecord of dnsRecord['ResourceRecords']) {
              innerWait
                .push(new Promise((rs, rj) => {
                  // parts example: '1 1 32768 ip-10-10-4-74.us-west-2.compute.internal'
                  // index           0 1 2     3
                  let resourceRecordParts = resourceRecord['Value'].split(' ');

                  if (resourceRecordParts.length !== 4) {
                    // non-conforming records, purge it
                    console.log(`${resourceRecord} does not have the required 4 space delineated SRV record parts and will be purged`);
                    return rs(dnsRecord);
                  }

                  let ec2InstanceDnsName = resourceRecordParts[3];
                  dns
                    .lookup(ec2InstanceDnsName, {family: 4}, (err, address) => {
                      if (err) {
                        // need some kind of retry here
                        console.log(`unable to lookup ${ec2InstanceDnsName}`);
                        return rj(err);
                      }

                      let port = resourceRecordParts[2];
                      let ip = address;

                      let found = searchEcsTask(ip, port, dnsRecord['Name']);
                      rs((found) ? null : dnsRecord);
                    });
                }));
            }

            Promise
              .all(innerWait)
              .then((purgeCandidates) => {
                let results = [];
                for (let candidate of purgeCandidates) {
                  if (candidate) results.push(candidate);
                }
                res(results);
              })
              .catch(rej);
          }));
      }

      Promise
        .all(wait)
        .then((arraysOfPurgeCandidates) => {

          let flattenedOutPurgeCandidates = [];
          for (let purgeCandidates of arraysOfPurgeCandidates) {
            if (purgeCandidates) {
              flattenedOutPurgeCandidates.push.apply(flattenedOutPurgeCandidates, purgeCandidates);
            }
          }
          state.purgeCandidates = flattenedOutPurgeCandidates;

          resolve(state);
        })
        .catch(reject);
    });
    /////

    function searchEcsTask(ip, port, hostName) {
      hostName = hostName.split('.')[0];
      let instanceArn = searchEc2Instances(ip);
      return (instanceArn)
        ? searchTask(port, instanceArn, hostName)
        : false;
    }

    function searchEc2Instances(ip) {
      let instanceArn = null;
      for (let ec2InstanceKeys of Object.keys(state.ec2InstanceMap)) {
        let ec2Instance = state.ec2InstanceMap[ec2InstanceKeys];

        if (ec2Instance.privateIP === ip) {
          instanceArn = ec2Instance.instanceArn;
          break;
        }
      }

      return instanceArn;
    }

    function searchTask(port, instanceArn, hostName) {

      let found = false;
      for (let taskArn of Object.keys(state.tasks)) {
        let task = state.tasks[taskArn];
        if (task.instance !== instanceArn) {
          continue;
        }

        for (let container of task.containers) {
          if (container.service === hostName && container.port.toString() === port.toString()) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      return found;
    }
  }

  purgeInvalidEntries(state) {
    return new Promise((resolve, reject) => {

      if (state.purgeCandidates && state.purgeCandidates.length === 0) {
        console.log('nothing to purge');
        return resolve('done, 0 records purged');
      }

      let params = {
        ChangeBatch: {
          Changes: [],
          Comment: 'Service Discovery Health Check Failed - deleted by Lambda Health Check',
        },
        HostedZoneId: this.zoneId
      };


      console.log('Purging');
      console.log('------------------------');
      for (let purge of state.purgeCandidates) {
        console.log(purge);
        params.ChangeBatch.Changes.push({
          Action: 'DELETE',
          ResourceRecordSet: purge
        });
      }
      console.log('------------------------');

      this
        .route53
        .changeResourceRecordSets(params, (err, data) => {
          if (err) {
            return reject(err);
          }
          console.log('purge complete');
          console.log(data);
          resolve(`done, ${state.purgeCandidates.length} records queued for deletion from zone`);
        });
    });

  }
}

module.exports = EcsSdHealth;
