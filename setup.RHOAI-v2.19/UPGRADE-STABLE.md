# Upgrading from RHOAI 2.16

These instructions assume you installed and configured RHOAI 2.16 following
the MLBatch [install instructions for RHOAI-v2.16](../setup.RHOAI-v2.16/CLUSTER-SETUP.md)
or the [stable stream upgrade instructions for RHOAI-V2.16](../setup.RHOAI-v2.16/UPGRADE-STABLE.md)
and are subscribed to the stable channel.

Your subscription will have automatically created an unapproved
install plan to upgrade to RHOAI 2.19.

Before beginning, verify that the expected install plan exists:
```sh
oc get ip -n redhat-ods-operator
```
Typical output would be:
```sh
NAME            CSV                     APPROVAL   APPROVED
install-kpzzl   rhods-operator.2.19.0   Manual     false
install-nqrbp   rhods-operator.2.16.0   Manual     true
```

Assuming the install plan exists you can begin the upgrade process.

As part of the upgrade, you must manually remove v1alpha1 MultiKueue CRD's
from your cluster. These CRDs were replaced by v1beta1 versions in the Kueue 0.9 release,
but the RHOAI operator will not automatically remove CRDs.

First, ensure that you have no instances:
```sh
kubectl get multikueueclusters.kueue.x-k8s.io --all-namespaces
kubectl get multikueueconfigs.kueue.x-k8s.io --all-namespaces
```
If you do have any instances, delete them before proceeding.

Next, update the MLBatch modifications to the default RHOAI configuration maps and subscription.
```sh
oc delete cm mlbatch-kuberay -n redhat-ods-operator
oc delete cm mlbatch-codeflare -n redhat-ods-operator
oc apply -f setup.RHOAI-v2.19/mlbatch-upgrade-configmaps.yaml
oc apply -f setup.RHOAI-v2.19/mlbatch-upgrade-fast-subscription.yaml
oc apply -f setup.RHOAI-v2.19/mlbatch-network-policy.yaml
```

Next, you can approve the install plan replacing the example plan name below
with the actual value on your cluster:
```sh
oc patch ip -n redhat-ods-operator --type merge --patch '{"spec":{"approved":true}}' install-kpzzl
```

After the upgraded operator pod is running in the `redhat-ods-operator` namespace,
delete the v1alpha1 MultiKueue CRDs (this will enable the operator to proceed with updating Kueue).
```sh
kubectl delete crd multikueueclusters.kueue.x-k8s.io
kubectl delete crd multikueueconfigs.kueue.x-k8s.io
```

Finally, delete the `kueue-metrics-service` from the `redhat-ods-applications` namespace and
let the operator recreate it. This removes port `8080`, which is no longer used.
```sh
oc delete service kueue-metrics-service -n redhat-ods-applications
```
