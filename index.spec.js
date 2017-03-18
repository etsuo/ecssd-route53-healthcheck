'use strict';

const app = require('./index');

describe('index.js', function () {
    it('has a Lambda handler function that returns a callback with some kind of defined result', function (done) {

        app.handler(null, {}, (err, result) => {
            if (err) {
                done.fail(err);
            }
            expect(result).toBeDefined();
            done();
        });
    });
});
