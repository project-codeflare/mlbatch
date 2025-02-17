# Cluster Setup

The cluster setup installs Red Hat OpenShift AI and Coscheduler, configures Kueue,
cluster roles, and priority classes.

## Priorities

Create `default-priority`, `high-priority`, and `low-priority` priority classes:
```sh
oc apply -f setup.RHOAI-v2.17/mlbatch-priorities.yaml
```

## Coscheduler

Install Coscheduler v0.28.9 as a secondary scheduler and configure packing:
```sh
helm install scheduler-plugins --namespace scheduler-plugins --create-namespace \
  scheduler-plugins/manifests/install/charts/as-a-second-scheduler/ \
  --set-json pluginConfig='[{"args":{"scoringStrategy":{"resources":[{"name":"nvidia.com/gpu","weight":1}],"requestedToCapacityRatio":{"shape":[{"utilization":0,"score":0},{"utilization":100,"score":10}]},"type":"RequestedToCapacityRatio"}},"name":"NodeResourcesFit"},{"args":{"permitWaitingTimeSeconds":300},"name":"Coscheduling"}]'
```
Patch Coscheduler pod priorities:
```sh
oc patch deployment -n scheduler-plugins --type=json --patch-file setup.RHOAI-v2.17/coscheduler-priority-patch.yaml scheduler-plugins-controller
oc patch deployment -n scheduler-plugins --type=json --patch-file setup.RHOAI-v2.17/coscheduler-priority-patch.yaml scheduler-plugins-scheduler
```

## Red Hat OpenShift AI

Create the Red Hat OpenShift AI subscription:
```sh
oc apply -f setup.RHOAI-v2.17/mlbatch-subscription.yaml
````
Identify install plan:
```sh
oc get ip -n redhat-ods-operator
```
```
NAMESPACE             NAME            CSV                     APPROVAL   APPROVED
redhat-ods-operator   install-kmh8w   rhods-operator.2.16.0   Manual     false
```
Approve install plan replacing the generated plan name below with the actual
value:
```sh
oc patch ip -n redhat-ods-operator --type merge --patch '{"spec":{"approved":true}}' install-kmh8w
```
Create DSC Initialization:
```sh
oc apply -f setup.RHOAI-v2.17/mlbatch-dsci.yaml
```
Create Data Science Cluster:
```sh
oc apply -f setup.RHOAI-v2.17/mlbatch-dsc.yaml
```
The provided DSCI and DSC are intended to install a minimal set of Red Hat OpenShift
AI managed components: `codeflare`, `kueue`, `ray`, and `trainingoperator`. The
remaining components such as `dashboard` can be optionally enabled.

The configuration of the managed components differs from the default Red Hat OpenShift
AI configuration as follows:
- Kubeflow Training Operator:
  - `gang-scheduler-name` is set to `scheduler-plugins-scheduler`,
- Kueue:
  - `manageJobsWithoutQueueName` is enabled,
  - `batch/job` integration is disabled,
  - `waitForPodsReady` is disabled,
  - `LendingLimit` feature gate is enabled,
  - `fairSharing` is enabled,
  - `enableClusterQueueResources` metrics is enabled,
- Codeflare operator:
  - the AppWrapper controller is enabled and configured as follows:
    - `userRBACAdmissionCheck` is disabled,
    - `schedulerName` is set to `scheduler-plugins-scheduler`,
    - `queueName` is set to `default-queue`,
    - `slackQueueName` is set to `slack-cluster-queue`
- pod priorities, resource requests and limits have been adjusted.



## Kueue Configuration

Create Kueue's default flavor:
```sh
oc apply -f setup.RHOAI-v2.17/default-flavor.yaml
```

## Cluster Role

Create `mlbatch-edit` role:
```sh
oc apply -f setup.RHOAI-v2.17/mlbatch-edit-role.yaml
```

## Slack Cluster Queue

Create the designated slack `ClusterQueue` which will be used to automate
minor adjustments to cluster capacity caused by node failures and
scheduler maintanence.
```sh
oc apply -f- << EOF
apiVersion: kueue.x-k8s.io/v1beta1
kind: ClusterQueue
metadata:
  name: slack-cluster-queue
spec:
  namespaceSelector: {}
  cohort: default-cohort
  preemption:
    withinClusterQueue: LowerOrNewerEqualPriority
    reclaimWithinCohort: Any
    borrowWithinCohort:
      policy: Never
  resourceGroups:
  - coveredResources: ["cpu", "memory", "nvidia.com/gpu", "nvidia.com/roce_gdr", "pods"]
    flavors:
    - name: default-flavor
      resources:
      - name: "cpu"
        nominalQuota: 8000m
      - name: "memory"
        nominalQuota: 128Gi
      - name: "nvidia.com/gpu"
        nominalQuota: 8
      - name: "nvidia.com/roce_gdr"
        nominalQuota: 1
      - name: "pods"
        nominalQuota: 100
EOF
```
Edit the above quantities to adjust the quota to the desired
values. Pod counts are optional and can be omitted from the list of
covered resources.  The `lendingLimit` for each resource will be
dynamically adjusted by the MLBatch system to reflect reduced cluster
capacity. See [QUOTA_MAINTENANCE.md](../QUOTA_MAINTENANCE.md) for a
detailed discussion of the role of the slack `ClusterQueue`.
