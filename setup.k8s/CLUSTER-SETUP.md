# Cluster Setup

The cluster setup installs and configures the following components:
+ Scheduler Plugins
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

## Scheduler Configuration

MLBatch configures Kubernetes scheduling to accomplish two objectives:
+ Obtaining gang (all or nothing) scheduling for multi-Pod workloads.
+ Packing Pods whose GPU request is less than the number of GPUs on a Node to
  maximize the number of Nodes available for Pods that request all the GPUs on a Node.

The currently recommend way to do this is by installing the Coscheduling out-of-tree scheduler
plugin and configuring the default NodeResourcesFit scheduler plugin to pack in the GPU dimension.
Alternatively, you can skip the helm install and patch commands shown below and instead install
the experimental Sakkara scheduler plugin (described next).


```sh
helm install scheduler-plugins --namespace scheduler-plugins --create-namespace \
  scheduler-plugins/manifests/install/charts/as-a-second-scheduler/ \
  --set-json pluginConfig='[{"args":{"scoringStrategy":{"resources":[{"name":"nvidia.com/gpu","weight":1}],"requestedToCapacityRatio":{"shape":[{"utilization":0,"score":0},{"utilization":100,"score":10}]},"type":"RequestedToCapacityRatio"}},"name":"NodeResourcesFit"},{"args":{"permitWaitingTimeSeconds":300},"name":"Coscheduling"}]'
```
Patch scheduler-plugins pod priorities:
```sh
kubectl patch deployment -n scheduler-plugins --type=json --patch-file setup.k8s/scheduler-priority-patch.yaml scheduler-plugins-controller
kubectl patch deployment -n scheduler-plugins --type=json --patch-file setup.k8s/scheduler-priority-patch.yaml scheduler-plugins-scheduler
```

### Sakkara

[Sakkara](https://github.com/atantawi/scheduler-plugins/tree/sakkara) is an experimental
new scheduler plugin with advanced support for topology-aware scheduling.

Install Sakkara as a secondary scheduler:
```sh
helm install sakkara-scheduler --namespace sakkara-scheduler --create-namespace mlbatch/sakkara-scheduler
```
Optionally, create a config map capturing your cluster's topology as described in the [Sakkara documentation](https://github.com/atantawi/sakkara-deploy/tree/main?tab=readme-ov-file#cluster-topology). This step is optional but recommended for production clusters. If the config map is not present Sakkara will default to a single-level hierarchy containing the Nodes of the cluster.

## Install Operators

Create the mlbatch-system namespace
```sh
kubectl create namespace mlbatch-system
```

Install the Kubeflow Training Operator

If you are using Coscheduling do:
```sh
kubectl apply --server-side -k setup.k8s/training-operator/coscheduling
```
If you are using Sakkara do:
```sh
kubectl apply --server-side -k setup.k8s/training-operator/sakkara
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
If you are using Coscheduling do:
```sh
kubectl apply --server-side -k setup.k8s/appwrapper/coscheduling
```
If you are using Sakkara do:
```sh
kubectl apply --server-side -k setup.k8s/appwrapper/sakkara
```

The provided configuration differs from the default configuration of the
operators as follows:
- Kubeflow Training Operator:
  - `gang-scheduler-name` is set to either `scheduler-plugins-scheduler` or `sakkara-scheduler`,
- Kueue:
  - `batch/job` integration is disabled,
  - `manageJobsWithoutQueueName` is enabled and configured via `managedJobsNamespaceSelector` to be
     scoped to only namespaces that are labeled with `mlbatch-team-namespace=true`.
  - `waitForPodsReady` is disabled,
  - `fairSharing` is enabled,
  - `enableClusterQueueResources` metrics is enabled,
- AppWrapper operator:
  - `userRBACAdmissionCheck` is disabled,
  - `schedulerName` is set to `scheduler-plugins-scheduler` or `sakkara-scheduler`,
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
