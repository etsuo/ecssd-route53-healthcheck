'use strict';

require('colors');
const AWS = require('aws-sdk');

if (!AWS.config.region || AWS.config.region === '') {
  console.log('You must have an AWS region set. You can use the environment variable AWS_REGION to accomplish this.'.red);
  process.exit(1);
}
