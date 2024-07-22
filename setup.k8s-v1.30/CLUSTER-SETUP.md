# Cluster Setup

The cluster setup installs and configures the following components:
+ Coscheduler
+ Kubeflow Training Operator
+ KubeRay
+ Kueue
+ AppWrappers
+ Cluster roles and priority classes

If MLBatch is deployed on a cluster that used to run earlier versions of ODH,
[MCAD](https://github.com/project-codeflare/mcad), or Coscheduler,
make sure to scrub traces of these installations. In particular, make sure to
delete the following custom resource definitions (CRD) if present on the
cluster. Make sure to delete all instances prior to deleting the CRDs:
```sh
# Delete old appwrappers and crd
kubectl delete appwrappers --all -A
kubectl delete crd appwrappers.workload.codeflare.dev

# Delete old noderesourcetopologies and crd
kubectl delete noderesourcetopologies --all -A
kubectl delete crd noderesourcetopologies.topology.node.k8s.io
```

## Priorities

Create `default-priority`, `high-priority`, and `low-priority` priority classes:
```sh
kubectl apply -f setup.k8s-v1.30/mlbatch-priorities.yaml
```

## Coscheduler

Install Coscheduler v0.28.9 as a secondary scheduler and configure packing:
```sh
helm install scheduler-plugins --namespace scheduler-plugins --create-namespace \
  scheduler-plugins/manifests/install/charts/as-a-second-scheduler/ \
  --set-json pluginConfig='[{"args":{"scoringStrategy":{"resources":[{"name":"nvidia.com/gpu","weight":1}],"requestedToCapacityRatio":{"shape":[{"utilization":0,"score":0},{"utilization":100,"score":10}]},"type":"RequestedToCapacityRatio"}},"name":"NodeResourcesFit"}]'
```
Patch Coscheduler pod priorities:
```sh
kubectl patch deployment -n scheduler-plugins --type=json --patch-file setup.k8s-v1.30/coscheduler-priority-patch.yaml scheduler-plugins-controller
kubectl patch deployment -n scheduler-plugins --type=json --patch-file setup.k8s-v1.30/coscheduler-priority-patch.yaml scheduler-plugins-scheduler
```

## Install Operators

Create the mlbatch-system namespace
```sh
kubectl create namespace mlbatch-system
```

Install the Kubeflow Training Operator
```sh
kubectl apply --server-side -k setup.k8s-v1.30/training-operator
```

Install the KubeRay Operator
```sh
kubectl apply --server-side -k setup.k8s-v1.30/kuberay
```

Install Kueue
```sh
kubectl apply --server-side -k setup.k8s-v1.30/kueue
```

Install the AppWrapper Operator
```sh
kubectl apply --server-side -k setup.k8s-v1.30/appwrapper
```
The provided configuration differs from the default configuration of the
operators as follows:
- Kubeflow Training Operator:
  - `gang-scheduler-name` is set to `scheduler-plugins-scheduler`,
- Kueue:
  - `waitForPodsReady` is disabled,
  - `LendingLimit` feature gate is enabled,
- AppWrapper operator:
  - `userRBACAdmissionCheck` is disabled,
  - `schedulerName` is set to `scheduler-plugins-scheduler`,
  - `queueName` is set to `default-queue`,
- pod priorities, resource requests and limits have been adjusted.

## Kueue Configuration

Create Kueue's default flavor:
```sh
kubectl apply -f setup.k8s-v1.30/default-flavor.yaml
```

## Cluster Role

Create `mlbatch-edit` role:
```sh
kubectl apply -f setup.k8s-v1.30/mlbatch-edit-role.yaml
```
## Validating Admission Policy

Create an admission policy to enforce that all pod-creating resources
permitted by the mlbatch-edit role that are created in team namespaces
will have local queue names and thus be subject to Kueue's quota management.
```sh
kubectl apply -f setup.k8s-v1.30/admission-policy.yaml
```
