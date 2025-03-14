# Cluster Setup

The cluster setup installs and configures the following components:
+ Coscheduler
+ Kubeflow Training Operator
+ KubeRay
+ Kueue
+ AppWrappers
+ Cluster roles and priority classes
+ Autopilot

## Priorities

Create `default-priority`, `high-priority`, and `low-priority` priority classes:
```sh
kubectl apply -f setup.k8s/mlbatch-priorities.yaml
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
kubectl patch deployment -n scheduler-plugins --type=json --patch-file setup.k8s/coscheduler-priority-patch.yaml scheduler-plugins-controller
kubectl patch deployment -n scheduler-plugins --type=json --patch-file setup.k8s/coscheduler-priority-patch.yaml scheduler-plugins-scheduler
```

## Install Operators

Create the mlbatch-system namespace
```sh
kubectl create namespace mlbatch-system
```

Install the Kubeflow Training Operator
```sh
kubectl apply --server-side -k setup.k8s/training-operator
```

Install the KubeRay Operator
```sh
kubectl apply --server-side -k setup.k8s/kuberay
```

Install Kueue
```sh
kubectl apply --server-side -k setup.k8s/kueue
```

Install the AppWrapper Operator
```sh
kubectl apply --server-side -k setup.k8s/appwrapper
```
The provided configuration differs from the default configuration of the
operators as follows:
- Kubeflow Training Operator:
  - `gang-scheduler-name` is set to `scheduler-plugins-scheduler`,
- Kueue:
  - `batch/job` integration is disabled,
  - `manageJobsWithoutQueueName` is enabled and configured via `managedJobsNamespaceSelector` to be
     scoped to only namespaces that are labeled with `mlbatch-team-namespace=true`.
  - `waitForPodsReady` is disabled,
  - `LendingLimit` feature gate is enabled,
  - `fairSharing` is enabled,
  - `enableClusterQueueResources` metrics is enabled,
- AppWrapper operator:
  - `userRBACAdmissionCheck` is disabled,
  - `schedulerName` is set to `scheduler-plugins-scheduler`,
  - `queueName` is set to `default-queue`,
- pod priorities, resource requests and limits have been adjusted.

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

The `ServiceMonitor` object is the one that enables Prometheus to scrape the metrics produced by Autopilot.
In order for Prometheus to find the right objects, the `ServiceMonitor` needs to be annotated with the Prometheus' release name. It is usually `prometheus`, and that's the default added in the Autopilot release.
If that is not the case in your cluster, the correct release label can be found by checking in the `ServiceMonitor` of Prometheus itself, or the name of Prometheus helm chart.
Then, Autopilot's `ServiceMonitor` can be labeled with the following command

```bash
kubectl label servicemonitors.monitoring.coreos.com -n autopilot autopilot-metrics-monitor release=<prometheus-release-name> --overwrite
```

## Kueue Configuration

Create Kueue's default flavor:
```sh
kubectl apply -f setup.k8s/default-flavor.yaml
```

## Cluster Role

Create `mlbatch-edit` role:
```sh
kubectl apply -f setup.k8s/mlbatch-edit-role.yaml
```

## Slack Cluster Queue

Create the designated slack `ClusterQueue` which will be used to automate
minor adjustments to cluster capacity caused by node failures and
scheduler maintanence.
```sh
kubectl apply -f- << EOF
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
