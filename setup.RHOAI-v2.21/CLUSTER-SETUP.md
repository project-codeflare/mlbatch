# Cluster Setup

The cluster setup installs Red Hat OpenShift AI and configures Scheduler Plugins, Kueue,
cluster roles, and priority classes.

## Priorities

Create `default-priority`, `high-priority`, and `low-priority` priority classes:
```sh
oc apply -f setup.RHOAI-v2.21/mlbatch-priorities.yaml
```

## Scheduler Configuration

MLBatch configures Kubernetes scheduling to accomplish two objectives:
+ Obtaining gang (all or nothing) scheduling for multi-Pod workloads.
+ Packing Pods whose GPU request is less than the number of GPUs on a Node to
  maximize the number of Nodes available for Pods that request all the GPUs on a Node.

This is done by installing the Coscheduling out-of-tree scheduler plugin and configuring
the default NodeResourcesFit scheduler plugin to pack in the GPU dimension.


```sh
helm install scheduler-plugins --namespace scheduler-plugins --create-namespace \
  scheduler-plugins/manifests/install/charts/as-a-second-scheduler/ \
  --set-json pluginConfig='[{"args":{"scoringStrategy":{"resources":[{"name":"nvidia.com/gpu","weight":1}],"requestedToCapacityRatio":{"shape":[{"utilization":0,"score":0},{"utilization":100,"score":10}]},"type":"RequestedToCapacityRatio"}},"name":"NodeResourcesFit"},{"args":{"permitWaitingTimeSeconds":300},"name":"Coscheduling"}]'
```
Patch scheduler-plugins pod priorities:
```sh
oc patch deployment -n scheduler-plugins --type=json --patch-file setup.RHOAI-v2.21/scheduler-priority-patch.yaml scheduler-plugins-controller
oc patch deployment -n scheduler-plugins --type=json --patch-file setup.RHOAI-v2.21/scheduler-priority-patch.yaml scheduler-plugins-scheduler
```



## Red Hat OpenShift AI

Create the Red Hat OpenShift AI subscription:
```sh
oc apply -f setup.RHOAI-v2.21/mlbatch-subscription.yaml
```
Create the mlbatch NetworkPolicy in the redhat-ods-applications namespace.
```sh
oc apply -f setup.RHOAI-v2.21/mlbatch-network-policy.yaml
```
Identify install plan:
```sh
oc get ip -n redhat-ods-operator
```
```
NAMESPACE             NAME            CSV                     APPROVAL   APPROVED
redhat-ods-operator   install-kmh8w   rhods-operator.2.21.0   Manual     false
```
Approve install plan replacing the generated plan name below with the actual
value:
```sh
oc patch ip -n redhat-ods-operator --type merge --patch '{"spec":{"approved":true}}' install-kmh8w
```
Create DSC Initialization:
```sh
oc apply -f setup.RHOAI-v2.21/mlbatch-dsci.yaml
```
Create Data Science Cluster:
```sh
oc apply -f setup.RHOAI-v2.21/mlbatch-dsc.yaml
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
  - `fairSharing` is enabled,
  - `enableClusterQueueResources` metrics is enabled,
- Codeflare operator:
  - the AppWrapper controller is enabled and configured as follows:
    - `userRBACAdmissionCheck` is disabled,
    - `schedulerName` is set to `scheduler-plugins-scheduler`,
    - `queueName` is set to `default-queue`,
    - `slackQueueName` is set to `slack-cluster-queue`

## Autopilot

Helm charts values and how-to for customization can be found [in the official documentation](https://github.com/IBM/autopilot/blob/main/helm-charts/autopilot/README.md). As-is, Autopilot will run on GPU nodes.

- Add the Autopilot Helm repository

```bash
helm repo add autopilot https://ibm.github.io/autopilot/
helm repo update
```

- Install the chart (idempotent command). The config file is for customizing the helm values and it is optional.

```bash
helm upgrade autopilot autopilot/autopilot --install --namespace=autopilot --create-namespace -f your-config.yml
```

### Enabling Prometheus metrics

After completing the installation, manually label the namespace to enable metrics to be scraped by Prometheus with the following command:

```bash
oc label ns autopilot openshift.io/cluster-monitoring=true
```

The `ServiceMonitor` labeling is not required.

## Kueue Configuration

Create Kueue's default flavor:
```sh
oc apply -f setup.RHOAI-v2.21/default-flavor.yaml
```

## Cluster Role

Create `mlbatch-edit` role:
```sh
oc apply -f setup.RHOAI-v2.21/mlbatch-edit-role.yaml
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
