# MLBatch Setup

The MLBatch setup consists of a [cluster setup](#cluster-setup) to be done once
and a [project setup](#project-setup) to be repeated for each team. This
document also discusses [quota maintenance](#quota-maintenance).

Batch users should only be permitted to create AppWrappers or workloads whose
types are natively supported by Kueue. The provided `mlbatch-edit` role permits
the creation of `PyTorchJobs`, `RayJobs`, `RayClusters`, and `AppWrappers`.
Kueue at this time has no mechanism for granular quota enforcement for `Jobs`,
i.e., no mechanism to enforce quotas only on user-submitted `Jobs` without
impacting OpenShift-internal `Jobs`. As a consequence, MLBatch disables queuing
and quota management for `Jobs` and the `mlbatch-edit` role does not give
permission to create `Jobs`. While `Jobs`, or `Pods` and `Deployments` cannot be
created by MLBatch users directly, `AppWrappers` can easily wrap and bundle
resources of these types. See [USAGE.md](USAGE.md) for examples.

This setup has been developed on OpenShift 4.14 is intended to support OpenShift
4.12 and up.

To start with, recursively clone and enter this repository:
```sh
git clone --recursive https://github.com/project-codeflare/mlbatch.git
cd mlbatch
```

## Cluster Setup

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

### Priorities

Create `default-priority`, `high-priority`, and `low-priority` priority classes:
```sh
oc apply -f setup/mlbatch-priorities.yaml
```

### Coscheduler

Install Coscheduler v0.28.9 as a secondary scheduler and configure packing:
```sh
helm install scheduler-plugins --namespace scheduler-plugins --create-namespace \
  scheduler-plugins/manifests/install/charts/as-a-second-scheduler/ \
  --set-json pluginConfig='[{"args":{"scoringStrategy":{"resources":[{"name":"nvidia.com/gpu","weight":1}],"requestedToCapacityRatio":{"shape":[{"utilization":0,"score":0},{"utilization":100,"score":10}]},"type":"RequestedToCapacityRatio"}},"name":"NodeResourcesFit"}]'
```
Patch Coscheduler pod priorities:
```sh
oc patch deployment -n scheduler-plugins --type=json --patch-file setup/coscheduler-priority-patch.yaml scheduler-plugins-controller
oc patch deployment -n scheduler-plugins --type=json --patch-file setup/coscheduler-priority-patch.yaml scheduler-plugins-scheduler
```

### OpenShift AI

Create OpenShift AI 2.10 subscription:
```sh
oc apply -f setup/mlbatch-subscription.yaml
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
oc apply -f setup/mlbatch-dsci.yaml
```
Create Data Science Cluster:
```sh
oc apply -f setup/mlbatch-dsc.yaml
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

### Kueue Configuration

Create Kueue's default flavor:
```sh
oc apply -f setup/default-flavor.yaml
```

### Cluster Role

Create `mlbatch-edit` role:
```sh
oc apply -f setup/mlbatch-edit-role.yaml
```

## Project Setup

The project setup creates a project, a user group, a quota, a queue, and the
required role bindings.

Create project:
```sh
oc new-project team1
```
Create user group:
```sh
oc adm groups new team1-edit-group
```
Add users to group for example:
```sh
oc adm groups add-users team1-edit-group user1
```
Bind cluster role to group in namespace:
```sh
oc adm policy add-role-to-group mlbatch-edit team1-edit-group --role-namespace="" --namespace team1
```
Specify the intended quota for the namespace by creating a `ClusterQueue`:
```sh
oc apply -f- << EOF
apiVersion: kueue.x-k8s.io/v1beta1
kind: ClusterQueue
metadata:
  name: team1-cluster-queue
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
        # borrowingLimit: 0
        # lendingLimit: 0
      - name: "memory"
        nominalQuota: 128Gi
        # borrowingLimit: 0
        # lendingLimit: 0
      - name: "nvidia.com/gpu"
        nominalQuota: 16
        # borrowingLimit: 0
        # lendingLimit: 0
      - name: "nvidia.com/roce_gdr"
        nominalQuota: 4
        # borrowingLimit: 0
        # lendingLimit: 0
      - name: "pods"
        nominalQuota: 100
        # borrowingLimit: 0
        # lendingLimit: 0
EOF
```
Edit the above quantities to adjust the quota to the desired values. Pod counts
are optional and can be omitted from the list of covered resources.

Uncomment all `borrowingLimit` lines to prevent this namespace from borrowing
quota from other namespaces. Uncomment all `lendingLimit` lines to prevent other
namespaces from borrowing quota from this namespace.

Create a `LocalQueue` to bind the `ClusterQueue` to the namespace:
```sh
oc apply -n team1 -f- << EOF
apiVersion: kueue.x-k8s.io/v1beta1
kind: LocalQueue
metadata:
  name: default-queue
spec:
  clusterQueue: team1-cluster-queue
EOF
```
We recommend naming the local queue `default-queue` as `AppWrappers` will
default to this queue name.

## Quota Maintenance

Kubernetes built-in `ResourceQuotas` should not be combined with Kueue quotas.

Kueue quotas can be adjusted post creation. Workloads already admitted are not
impacted.

For Kueue quotas to be effective, the sum of all quotas for each managed
resource (`cpu`, `memory`, `nvidia.com/gpu`, `pods`) must be maintained to
remain less than or equal to the available cluster capacity for this resource.
Concretely, for cluster with 256 NVIDIA GPUs dedicated to MLBatch users, the
cumulative `nomimalQuota` for the `nvidia.com/gpu` resource should be 256 or
less. Quotas should be reduced when the available capacity is reduced whether
because of failures or due to the allocation of resources to non-batch
workloads.

To facilitate the necessary quota adjustments, one option is to setup a
dedicated cluster queue for slack capacity that other cluster queues can borrow
from. This queue should not be associated with any team, project, namespace, or
local queue. Its quota should be adjusted dynamically to reflect changes in
cluster capacity. If sized appropriately, this queue will make adjustments to
other cluster queues unnecessary for small cluster capacity changes. Concretely,
two teams could be granted 45% of the cluster capacity, with 10% capacity set
aside for this extra cluster queue. Any changes to the cluster capacity below
10% can then be handled by adjusting the latter.

Every resource name occurring in the resource requests or limits of a workload
must be covered by a cluster queue intended to admit the workload, even if the
requested resource count is zero. For example. a cluster queue must cover
`nvidia.com/roce_gdr`, possibly with an empty quota, to admit a `PyTorchJob`
requesting:
```yaml
  resources:
    requests:
      cpu: 1
      memory: 256Mi
      nvidia.com/roce_gdr: 0
    limits:
      cpu: 1
      memory: 256Mi
      nvidia.com/roce_gdr: 0
```

## Cleanup

To uninstall the MLBatch controllers and reclaim the corresponding namespaces,
run:
```sh
# OpenShift AI uninstall
oc delete dsc mlbatch-dsc
oc delete dsci mlbatch-dsci
oc delete subscription -n redhat-ods-operator rhods-operator
oc delete csv -n redhat-ods-operator -l operators.coreos.com/rhods-operator.redhat-ods-operator
oc delete crd featuretrackers.features.opendatahub.io \
  dscinitializations.dscinitialization.opendatahub.io \
  datascienceclusters.datasciencecluster.opendatahub.io
oc delete operators rhods-operator.redhat-ods-operator
oc delete operatorgroup -n redhat-ods-operator rhods-operator
oc delete namespace redhat-ods-applications redhat-ods-monitoring redhat-ods-operator

# Coscheduler uninstall
helm uninstall -n scheduler-plugins scheduler-plugins
oc delete namespace scheduler-plugins
```
