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
kubectl apply -f setup.k8s-v1.25/mlbatch-priorities.yaml
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
kubectl patch deployment -n scheduler-plugins --type=json --patch-file setup.k8s-v1.25/coscheduler-priority-patch.yaml scheduler-plugins-controller
kubectl patch deployment -n scheduler-plugins --type=json --patch-file setup.k8s-v1.25/coscheduler-priority-patch.yaml scheduler-plugins-scheduler
```

## Install Operators

TODO: *** UNDER CONSTRUCTION **

## Kueue Configuration

Create Kueue's default flavor:
```sh
kubectl apply -f setup.k8s-v1.25/default-flavor.yaml
```

## Cluster Role

Create `mlbatch-edit` role:
```sh
kubectl apply -f setup.k8s-v1.25/mlbatch-edit-role.yaml
```
