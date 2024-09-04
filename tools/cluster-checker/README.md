# Cluster Checker

The tool in this directory produces a summary view on GPU quotas and utilization
on the cluster. It also diagnoses the state of a cluster looking for common
issues.

The tool is implemented in JavaScript and intended to run with Node.js.

Install [Node.js](https://nodejs.org/) with the npm package manager.

Install dependencies with:
```sh
npm install
```

Run the tool against the current Kubernetes context with:
```sh
node checker.js
```
```
CLUSTER QUEUE         GPU QUOTA   GPU USAGE   ADMITTED WORKLOADS   PENDING WORKLOADS
team1-cluster-queue           8          16                    1                   0
team2-cluster-queue           8           4                    4                   0

Total GPU count in cluster:        24
Unschedulable GPU count:         -  0
Schedulable GPU count:           = 24

Nominal GPU quota:                 16
Slack GPU quota:                 +  8
Total GPU quota:                 = 24

GPU usage by admitted workloads:   20
Borrowed GPU count:                 8

WARNING: workload "default/pytorchjob-job-e6381" refers to a non-existent local queue "test-queue"
```