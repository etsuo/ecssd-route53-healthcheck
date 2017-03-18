# Introduction

This code is designed to be implemented as a Lambda function in AWS. It monitors a Route53 Zone file and compares its findings there with the current state of the ECS Cluster. If it finds entries for tasks (docker containers) that are no longer running, then it removes those entries from Route53.

# Contribution

Please report bugs and suggestions in the Issues section of the Github repo. If you'd like to submit a change, fork the repoository and submit your suggested changes as a Pull Request.
