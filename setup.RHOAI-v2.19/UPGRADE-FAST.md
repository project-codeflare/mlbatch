# Upgrading from RHOAI 2.19

These instructions assume you installed and configured RHOAI 2.18 following
the MLBatch [install instructions for RHOAI-v2.18](../setup.RHOAI-v2.18/CLUSTER-SETUP.md)
or the [upgrade instructions for RHOAI-V2.18](../setup.RHOAI-v2.18/UPGRADE.md)

Your subscription will have automatically created an unapproved
install plan to upgrade to RHOAI 2.19.

Before beginning, verify that the expected install plan exists:
```sh
oc get ip -n redhat-ods-operator
```
Typical output would be:
```sh
NAME            CSV                     APPROVAL   APPROVED
install-kpzzl   rhods-operator.2.18.0   Manual     false
install-nqrbp   rhods-operator.2.19.0   Manual     true
```

Before approving the upgrade, you must manually remove v1alpha1 MultiKueue CRD's
from your cluster. These CRDs were replaced by v1beta1 versions in the Kueue 0.9 release,
but the RHOAI operator will not automatically remove CRDs.
Ensure you have no instances:
```sh
kubectl get multikueueclusters.kueue.x-k8s.io --all-namespaces
kubectl get multikueueconfigs.kueue.x-k8s.io --all-namespaces
```
Delete all any instances.  Then delete the CRDs
```sh
kubectl delete crd multikueueclusters.kueue.x-k8s.io
kubectl delete crd multikueueconfigs.kueue.x-k8s.io
```

Next, update the MLBatch modifications to the default RHOAI configuration maps and subscription.
```sh
oc apply -f setup.RHOAI-v2.19/mlbatch-upgrade-configmaps.yaml
oc apply -f setup.RHOAI-v2.19/mlbatch-upgrade-fast-subscription.yaml
```

Finally, you can approve the install plan replacing the example plan name below
with the actual value on your cluster:
```sh
oc patch ip -n redhat-ods-operator --type merge --patch '{"spec":{"approved":true}}' install-kpzzl
```
