# Cluster Setup

The cluster setup installs OpenShift AI and Coscheduler, configures Kueue,
cluster roles, and priority classes.

If MLBatch is deployed on a cluster that used to run earlier versions of ODH,
[MCAD](https://github.com/project-codeflare/mcad), OpenShift AI, or Coscheduler,
make sure to scrub traces of these installations. In particular, make sure to
delete the following custom resource definitions (CRD) if present on the
cluster. Make sure to delete all instances prior to deleting the CRDs:
```sh
# Delete old appwrappers and crd
oc delete appwrappers --all -A
oc delete crd appwrappers.workload.codeflare.dev

# Delete old noderesourcetopologies and crd
oc delete noderesourcetopologies --all -A
oc delete crd noderesourcetopologies.topology.node.k8s.io
```

## Priorities

Create `default-priority`, `high-priority`, and `low-priority` priority classes:
```sh
oc apply -f setup.RHOAI-v2.10/mlbatch-priorities.yaml
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
oc patch deployment -n scheduler-plugins --type=json --patch-file setup.RHOAI-v2.10/coscheduler-priority-patch.yaml scheduler-plugins-controller
oc patch deployment -n scheduler-plugins --type=json --patch-file setup.RHOAI-v2.10/coscheduler-priority-patch.yaml scheduler-plugins-scheduler
```

## OpenShift AI

Create the OpenShift AI subscription:
```sh
oc apply -f setup.RHOAI-v2.10/mlbatch-subscription.yaml
````
Identify install plan:
```sh
oc get ip -n redhat-ods-operator
```
```
NAMESPACE             NAME            CSV                     APPROVAL   APPROVED
redhat-ods-operator   install-kmh8w   rhods-operator.2.10.0   Manual     false
```
Approve install plan replacing the generated plan name below with the actual
value:
```sh
oc patch ip -n redhat-ods-operator --type merge --patch '{"spec":{"approved":true}}' install-kmh8w
```
Create DSC Initialization:
```sh
oc apply -f setup.RHOAI-v2.10/mlbatch-dsci.yaml
```
Create Data Science Cluster:
```sh
oc apply -f setup.RHOAI-v2.10/mlbatch-dsc.yaml
```
The provided configuration differs from the default OpenShift AI configuration
as follows:
- Kubeflow Training Operator:
  - `gang-scheduler-name` is set to `scheduler-plugins-scheduler`,
- Kueue:
  - `manageJobsWithoutQueueName` is enabled,
  - `batch/job` integration is disabled,
  - `waitForPodsReady` is disabled,
- Codeflare operator:
  - the AppWrapper controller is enabled and configured as follows:
    - `userRBACAdmissionCheck` is disabled,
    - `schedulerName` is set to `scheduler-plugins-scheduler`,
    - `queueName` is set to `default-queue`,
- pod priorities, resource requests and limits have been adjusted.

To work around https://issues.redhat.com/browse/RHOAIENG-7887 (a race condition
in OpenShift AI 2.10 installation), do a rolling restart of the Kueue manager.
```sh
oc rollout restart deployment/kueue-controller-manager -n redhat-ods-applications
```

After doing the restart, verify that you see the following lines in the
kueue-controller-manager's log:
```sh
{"level":"info","ts":"2024-06-25T20:17:25.689638786Z","logger":"controller-runtime.builder","caller":"builder/webhook.go:189","msg":"Registering a validating webhook","GVK":"kubeflow.org/v1, Kind=PyTorchJob","path":"/validate-kubeflow-org-v1-pytorchjob"}
{"level":"info","ts":"2024-06-25T20:17:25.689698615Z","logger":"controller-runtime.webhook","caller":"webhook/server.go:183","msg":"Registering webhook","path":"/validate-kubeflow-org-v1-pytorchjob"}
{"level":"info","ts":"2024-06-25T20:17:25.689743757Z","logger":"setup","caller":"jobframework/setup.go:81","msg":"Set up controller and webhook for job framework","jobFrameworkName":"kubeflow.org/pytorchjob"}

```

## Kueue Configuration

Create Kueue's default flavor:
```sh
oc apply -f setup.RHOAI-v2.10/default-flavor.yaml
```

## Cluster Role

Create `mlbatch-edit` role:
```sh
oc apply -f setup.RHOAI-v2.10/mlbatch-edit-role.yaml
```