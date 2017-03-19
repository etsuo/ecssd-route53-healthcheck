#!/usr/bin/env node
'use strict';

require('colors');
const AWS = require('aws-sdk');
const inquirer = require('inquirer');
const fs = require('fs');
const glob = require('glob');
const packageJson = require('../package.json');
const path = require('path');
const program = require('commander');
const ProgressBar = require('progress');
const shell = require('shelljs');
const Spinner = require('cli-spinner').Spinner;
const Zip = require('node-zip');

AWS.config.apiVersions = {
  iam: '2010-05-08',
  lambda: '2015-03-31'
};

const DEPLOY_ZIP_FILE = './deploy.zip';
const CLEAR_SPINNER = true;
Spinner.setDefaultSpinnerString(19);

class Deploy {

  constructor() {
    this.config = {};
  }

  start() {
    console.log(`ecssd-route53-healthcheck starting`.green);

    program
      .version(packageJson.version)
      .option('-f, --force', 'Answer yes to continue through all warnings')
      .option('-n, --function-name [functionName]', 'Name of the function')
      .option('-r, --role [arn]', 'AWS ARN for IAM Role')
      .option('-R, --region [region]', 'An AWS region like us-west-2')
      .option('--skip-prune', 'Skip the --production pruning of Node_Modules');

    program.parse(process.argv);

    this
      .getConfig()
      .then((result) => {
        // Setup the configuration
        if (!result.confirm && !program.force) {
          console.log(`I'm quitting you.`.yellow);
          process.exit(0);
        }

        if (!AWS.config.region) {
          AWS.config.update({region: result.region || program.region});
        }
        this.config = result;
      })
      .then(this.createZipBuffer.bind(this))
      .then(this.findLambdaFunction.bind(this))
      .then(this.uploadLambdaFunction.bind(this))
      .then(() => {
        console.log('Done'.america);
      })
      .catch((err) => {
        console.log('An unexpected error occurred and the deployment cannot continue.'.red);
        console.log(err);
      });
  }

  ///////////
  createLambdaFunction() {
    return new Promise((resolve, reject) => {
      fs.readFile(DEPLOY_ZIP_FILE, (err, fileBuff) => {
        if (err) return reject(err);

        let params = {
          Code: {
            ZipFile: fileBuff
          },
          Description: 'Checks Route53 servicediscovery.internal zone against current running tasks in ECS default cluster and removes any invalid DNS entries for tasks no longer running.',
          FunctionName: this.config.functionName,
          Handler: 'index.handler',
          MemorySize: 128,
          Publish: true,
          Role: this.config.role,
          Runtime: 'nodejs4.3-edge',
          Timeout: 30,
          VpcConfig: {}
        };

        let lambda = new AWS.Lambda(params);

        lambda.createFunction(params, (err, data) => {
          if (err) return reject(err);
          resolve(data);
        });
      });
    });
  }

  createZipBuffer() {
    return new Promise((resolve, reject) => {
      pruneDevDependencies.call(this)
        .then(createZipPackage.bind(this))
        .then(replacePrunedDevPackages.bind(this))
        .then(resolve)
        .catch(reject);
    });

    //////
    function createZipPackage() {
      return new Promise((resolve, reject) => {
        let zip = new Zip();

        let include = (packageJson.deployGlob || {}).include || '**/*';
        let ignore = (packageJson.deployGlob || {}).ignore || ['*.spec.js', 'LICENSE', 'README.md', 'package.json', 'scripts/**', 'spec/**'];

        glob(include, {ignore: ignore}, (err, files) => {
          if (err) return reject(err);

          let bar = new ProgressBar('zipping [:bar] file: :file'.blue, {
            total: files.length,
            width: 20
          });

          for (let file of files) {
            bar.tick({file: file});
            if (file === 'deploy.zip') continue;
            if (fs.lstatSync(file).isDirectory()) {
              continue;
            } else {
              let f = fs.readFileSync(file);
              zip.file(file, f);
            }
          }

          let spinner = new Spinner(`writing ${DEPLOY_ZIP_FILE}...`.blue);
          spinner.start();

          let data = zip.generate({base64: false, compression: 'DEFLATE'});
          fs.writeFile(DEPLOY_ZIP_FILE, data, 'binary', (err) => {
            spinner.stop(CLEAR_SPINNER);
            console.log(`${DEPLOY_ZIP_FILE} created`.green);

            if (err)return reject(err);
            resolve();
          });
        });
      });
    }

    function pruneDevDependencies() {
      return new Promise((resolve, reject) => {
        if (!program.skipPrune) {
          let spinner = new Spinner('pruning npm dependencies...'.blue);

          spinner.start();
          shell.exec('npm prune --production', {async: true, silent: true}, (code) => {
            spinner.stop(CLEAR_SPINNER);
            console.log('node dev dependencies pruned'.green);

            (code > 0)
              ? reject(new Error(`Error code ${code} when pruning development dependencies`))
              : resolve();
          });

        } else {
          resolve();
        }
      });
    }

    function replacePrunedDevPackages() {
      return new Promise((resolve, reject) => {
        if (!program.skipPrune) {
          let spinner = new Spinner('reinstalling dev dependencies...'.blue);

          spinner.start();
          shell.exec('npm install', {async: true, silent: true}, (code) => {
            spinner.stop(CLEAR_SPINNER);
            console.log('node dev dependencies reinstalled'.green);

            (code > 0)
              ? reject(new Error(`Error code ${code} when pruning development dependencies`))
              : resolve();
          });
        } else {
          resolve();
        }
      });
    }
  }

  uploadLambdaFunction(func) {
    let spinner;

    return new Promise((resolve, reject) => {
      if (!func) {
        // the function doesn't exist yet
        inquirer
          .prompt([{
            message: `Lambda function '${this.config.functionName}' does not exist, are you sure you want to create it?`,
            type: 'confirm',
            name: 'confirmCreate',
            when: !!!program.force
          }])
          .then((answers) => {
            if (!answers.confirmCreate && !program.force) {
              console.log('Go on with you...'.yellow);
              process.exit(0);
            }
            return;
          })
          .then(() => {
            spinner = new Spinner(`Creating Lambda function ${this.config.functionName}`.blue);
            spinner.start();
          })
          .then(this.createLambdaFunction.bind(this))
          .then((result) => {
            if (spinner) spinner.stop(CLEAR_SPINNER);
            console.log(`Done creating Lambda function ${result.FunctionName}`.green);
            console.log(`Version: ${result.Version}`.green);
            console.log(`Arn: ${result.FunctionArn}`.green);
            console.log(`SHA256: ${result.CodeSha256}`.green);

            resolve(result);
          })
          .catch((err) => {
            if (spinner) spinner.stop(CLEAR_SPINNER);
            reject(err);
          });
      } else {
        spinner = new Spinner(`Updating Lambda function ${this.config.functionName}`.blue);
        spinner.start();

        this
          .updateLambdaFunction()
          .then((result) => {
            spinner.stop(CLEAR_SPINNER);
            console.log(`Done updating Lambda function ${result.FunctionName}`.green);
            console.log(`Version: ${result.Version}`.green);
            console.log(`Arn: ${result.FunctionArn}`.green);
            console.log(`SHA256: ${result.CodeSha256}`.green);

            resolve(result);
          })
          .catch((err) => {
            if (spinner) spinner.stop(CLEAR_SPINNER);
            reject(err);
          });
      }
    });
  }

  findLambdaFunction() {

    return new Promise((resolve, reject) => {
      let lambda = new AWS.Lambda();

      lambda
        .listFunctions((err, data) => {
          if (err) {
            reject(err);
          }

          if (!data || !data.Functions || data.Functions.length === 0) {
            return resolve(null);
          }

          let result = null;
          for (let func of data.Functions) {
            if (func.FunctionName === this.config.functionName) {
              result = func;
              break;
            }
          }
          resolve(result);
        });
    });
  }

  getConfig() {
    return new Promise((resolve, reject) => {

      if (!!program.force) {
        console.log(`Deploying Lambda function 'ecssd-route53-healthcheck' to AWS using profile '${AWS.config.credentials.profile}'${AWS.config.region ? ` in region '${AWS.config.region}'` : ''}`.green);
      }

      inquirer
        .prompt([
          {
            message: `Deploy Lambda function 'ecssd-route53-healthcheck' to AWS using profile '${AWS.config.credentials.profile}'${AWS.config.region || program.region ? ` in region '${AWS.config.region || program.region}'` : ''}?`,
            type: 'confirm',
            name: 'confirm',
            when: !!!program.force,
            validate: (answer) => {
              if (!answer) return resolve({confirm: false});
            }
          },
          {
            message: 'What region?',
            type: 'list',
            name: 'region',
            when: () => !AWS.config.region && !!!program.region,
            choices: () => {
              return [
                {name: 'us-east-1: US East (N. Virginia)', value: 'us-east-1'},
                {name: 'us-east-2: US East (Ohio)', value: 'us-east-2'},
                {name: 'us-west-1: US West (N. California)', value: 'us-west-1'},
                {name: 'us-west-2: US West (Oregon)', value: 'us-west-2'},
                {name: 'ap-northeast-2: Asia Pacific (Seoul)', value: 'ap-northeast-2'},
                {name: 'ap-southeast-1: Asia Pacific (Singapore)', value: 'ap-southeast-1'},
                {name: 'ap-southeast-2: Asia Pacific (Sydney)', value: 'ap-southeast-2'},
                {name: 'ap-northeast-1: Asia Pacific (Tokyo)', value: 'ap-northeast-1'},
                {name: 'eu-central-1: EU (Frankfurt)', value: 'eu-central-1'},
                {name: 'eu-west-1: EU (Ireland)', value: 'eu-west-1'},
                {name: 'eu-west-2: EU (London)', value: 'eu-west-2'},
              ]
            },
            default: 3
          },
          {
            message: 'Function Name?',
            type: 'input',
            name: 'functionName',
            when: !!!program.functionName,
            validate: (answer) => {
              return answer && answer.length > 0;
            },
            default: 'ecs_servicediscovery_route53_healthcheck'
          }, {
            message: 'Role?',
            type: 'list',
            name: 'role',
            when: !!!program.role,
            choices: this.getRoles.bind(this),
            pageSize: 40
          }
        ])
        .then((answers) => {
          answers.functionName = program.functionName || answers.functionName;
          answers.role = program.role || answers.role;
          resolve(answers);
        })
        .catch(reject);

    });
  }

  getRoles(answers) {
    return new Promise((resolve, reject) => {
      // The region might not be set yet if an ENV variable or cli option wasn't used
      let region = answers.region || AWS.config.region;
      let iAm = new AWS.IAM({region: region});

      iAm.listRoles({}, (err, data) => {
        if (err) return reject(err);

        let roles = [];
        for (let role of data.Roles) {
          roles.push({name: role.RoleName, value: role.Arn})
        }
        resolve(roles);
      });
    });
  }

  updateLambdaFunction() {
    return new Promise((resolve, reject) => {
      fs.readFile(DEPLOY_ZIP_FILE, (err, fileBuff) => {
        let params = {
          ZipFile: fileBuff,
          FunctionName: this.config.functionName
        };

        let lambda = new AWS.Lambda();

        lambda.updateFunctionCode(params, (err, data) => {
          if (err) return reject(err);
          resolve(data);
        });
      });
    });
  }
}

new Deploy().start();
