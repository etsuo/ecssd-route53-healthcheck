'use strict';

const EcsSdHealth = require('./index');

describe('index.js', function () {
  it('has a Lambda handler function that returns a callback with some kind of defined result', function (done) {
    // *** WARNING *** *** WARNING *** *** WARNING *** *** WARNING *** *** WARNING *** *** WARNING ***
    // note this is a life call, which means it will actually impact the environment it's pointing to.
    // *** WARNING *** *** WARNING *** *** WARNING *** *** WARNING *** *** WARNING *** *** WARNING ***

    EcsSdHealth.handler(null, {}, (err, result) => {
      if (err) {
        done.fail(err);
      }
      done();
    });
  });
});
