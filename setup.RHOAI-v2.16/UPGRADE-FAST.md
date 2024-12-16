# Upgrading from RHOAI 2.15

These instructions assume you installed and configured RHOAI 2.15 following
the MLBatch [install instructions for RHOAI-v2.15](../setup.RHOAI-v2.15/CLUSTER-SETUP.md)
or the [upgrade instructions for RHOAI-V2.15](../setup.RHOAI-v2.15/UPGRADE.md)

Your subscription will have automatically created an unapproved
install plan to upgrade to RHOAI 2.16.

Before beginning, verify that the expected install plan exists:
```sh
oc get ip -n redhat-ods-operator
```
Typical output would be:
```sh
NAME            CSV                     APPROVAL   APPROVED
install-kpzzl   rhods-operator.2.16.0   Manual     false
install-nqrbp   rhods-operator.2.15.0   Manual     true
```

Assuming the install plan exists you can begin the upgrade process.

First, update the MLBatch modifications to the default RHOAI configuration maps.
```sh
oc apply -f setup.RHOAI-v2.16/mlbatch-upgrade-configmaps.yaml
```

There are no MLBatch modifications to the default RHOAI configuration maps
beyond those already made in previous installs. Therefore, you can simply
approve the install plan replacing the example plan name below with the actual
value on your cluster:
```sh
oc patch ip -n redhat-ods-operator --type merge --patch '{"spec":{"approved":true}}' install-kpzzl
```
