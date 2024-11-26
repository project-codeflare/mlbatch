# Team Setup

A *team* in MLBatch is a group of users that share a resource quota.

Before setting up your teams and quotas, please read [QUOTA_MAINTENANCE.md](../QUOTA_MAINTENANCE.md)
for a discussion of our recommended best practices.


Setting up a new team requires the cluster admin to create a project,
a user group, a quota, a queue, and the required role bindings as described below.

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
