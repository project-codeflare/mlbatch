# MLBatch Setup

The MLBatch setup consists of a [cluster setup](#cluster-setup) to be done once
and a [team setup](#team-setup) to be repeated for each team that will
be using the cluster. This document also discusses [quota maintenance](#quota-maintenance).

Batch users should only be permitted to create AppWrappers or workloads whose
types are natively supported by Kueue. The cluster setup set defines a
`mlbatch-edit` role which enforces these restrictions and will be used in
the setup process for each team of MLBatch users that is onboarded.

This setup has been developed on OpenShift 4.14 and Kubernetes 1.27 and
is intended to support OpenShift 4.12 and up and/or Kubernetes 1.25 and up. 

To start with, recursively clone and enter this repository:
```sh
git clone --recursive https://github.com/project-codeflare/mlbatch.git
cd mlbatch
```

## Cluster Setup

Step by step setup instructions are provided for the following versions:
+ [OpenShift AI 2.10](./setup.RHOAI-v2.10/CLUSTER-SETUP.md)
<!---
+ [OpenShift AI 2.11](./setup.RHOAI-v2.11/CLUSTER-SETUP.md)
--->
+ [Kubernetes 1.25+](./setup.k8s-v1.25/CLUSTER-SETUP.md)
+ [Kubernetes 1.30+](./setup.k8s-v1.30/CLUSTER-SETUP.md)

## Team Setup

To onboard a team to the cluster, a cluster admin will create and configure
an OpenShift project (or Kubernetes namespace) for the team.

Step by step setup instructions are provided for the following versions:
+ [OpenShift AI 2.10](./setup.RHOAI-v2.10/TEAM-SETUP.md)
<!---
+ [OpenShift AI 2.11](./setup.RHOAI-v2.11/TEAM-SETUP.md)
--->
+ [Kubernetes 1.25+](./setup.k8s-v1.25/TEAM-SETUP.md)
+ [Kubernetes 1.30+](./setup.k8s-v1.30/TEAM-SETUP.md)

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

First, remove all team projects/namespaces and corresponding cluster queues.

Second, follow the version specific instructions to uninstall the MLBatch controllers
and reclaim the corresponding namespaces.
+ [OpenShift AI 2.10](./setup.RHOAI-v2.10/UNINSTALL.md)
<!---
+ [OpenShift AI 2.11](./setup.RHOAI-v2.11/UNINSTALL.md)
--->
+ [Kubernetes 1.25+](./setup.k8s-v1.25/UNINSTALL.md)
+ [Kubernetes 1.30+](./setup.k8s-v1.30/UNINSTALL.md)
