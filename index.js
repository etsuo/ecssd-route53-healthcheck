'use strict';

const AWS = require('aws-sdk');

class EcsSdHealth {

  static handler(event, context, callback) {
    console.log('starting handler');

    // TESTING
    console.log('event:');
    console.log(event);
    console.log('context:');
    console.log(context);
    callback(null, 'done');
    // ---- TESTING

    // new EcsSdHealth()
    //   .start(event, context)
    //   .then((results) => {
    //     console.log('done running handler');
    //     callback(null, results);
    //   })
    //   .catch((err) => {
    //     console.log('error running handler:');
    //     console.log(err);
    //     callback(err, null);
    //   });
  }

  constructor() {
  }

  start(event, context) {
    return new Promise((resolve, reject) => {
      this
        .getClusterList()
        .then((data) => {
          console.log(data);
          resolve('success');
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  getClusterList() {
    return new Promise((resolve, reject) => {
      let ecs = new AWS.ECS();

      let params = {};

      ecs.listClusters(params, (err, data) => {
        if (err) {
          reject(err);
        }
        resolve(data);
      });
    });
  }
}

module.exports = EcsSdHealth;
