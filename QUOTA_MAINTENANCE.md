# Quota Maintenance

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
