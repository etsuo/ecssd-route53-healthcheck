# Introduction

This code is designed to be implemented as a Lambda function in AWS. It monitors a Route53 Zone file and compares its findings there with the current state of the ECS Cluster. If it finds entries for tasks (docker containers) that are no longer running, then it removes those entries from Route53.

# Use

## Deploying

You must be able to successfully authenticate with the AWS CLI in order to use the deployment script.

`npm run deploy` will start an interactive deployment.

`AWS_REGION=us-west-2 npm run deploy` will start an interactive deployment with the region set to region us-west-2.

Alternatively, you can set your region once for your terminal session like this: 'setenv AWS_REGION=us-west-2'.

`npm run deploy -- --help` to get help on various options... don't forget to use `--` before the options since the deploy script is being called through `npm`.

Example: `npm run deploy -- -f -R us-west-2 -n ecs_servicediscovery_route53_healthcheck -r arn:aws:iam::123:role/lambda_servicediscovery_route53_healthcheck`

## Some notes about the Deployment Script
To deploy a lambda function with NodeJS support, you have to zip the relevant files and upload them via an S3 bucket, or the web portal, etc. The deploy script automates that process. It will
strip node_modules of all development packages, zip up the file and upload the Lambda function for you. You can either pass a bunch of command line arguments or use the interactive mode,
which will take you through a series of prompts to setup the Lambda function.

# Contribution

Please report bugs and suggestions in the Issues section of the Github repo. If you'd like to submit a change, fork the repoository and submit your suggested changes as a Pull Request.

## Testing
`AWS_REGION=us-west-2 npm test`

WARNING: this will actually run the function... there are currently no "mocked" unit-tests. If your AWS CLI setup points to an
environment you care about, don't run this!!

# Credits
Index.js is adapted from: https://github.com/awslabs/service-discovery-ecs-dns
