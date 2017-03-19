# Introduction

This code is designed to be implemented as a Lambda function in AWS. It monitors a Route53 Zone file and compares its findings there with the current state of the ECS Cluster. If it finds entries for tasks (docker containers) that are no longer running, then it removes those entries from Route53.

# Use

## Deploying

You must be able to successfully authenticate with the AWS CLI in order to use the deployment script.

`npm run deploy` will start an interactive deployment.

`AWS_REGION=us-west-2 npm run deploy` will start an interactive deployment with the region set to region us-west-2.

Alternatively, you can set your region once for your terminal session like this: 'setenv AWS_REGION=us-west-2'.

`npm run deploy -- --help` to get help on various options... don't forget to use `--` before the options since the deploy script is being called through `npm`.

# Contribution

Please report bugs and suggestions in the Issues section of the Github repo. If you'd like to submit a change, fork the repoository and submit your suggested changes as a Pull Request.
