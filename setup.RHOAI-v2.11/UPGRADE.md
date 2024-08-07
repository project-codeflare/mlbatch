# Upgrading from RHOAI 2.10

These instructions assume you installed and configured RHOAI 2.10 following
the MLBatch [install instructions for RHOAI-v2.10](../setup.RHOAI-v2.10/CLUSTER-SETUP.md).

Your subscription will have automatically created an unapproved
install plan to upgrade to RHOAI 2.11.

Before beginning, verify that the expected install plan exists:
```sh
oc get ip -n redhat-ods-operator
```
Typical output would be:
```sh
NAME            CSV                     APPROVAL   APPROVED
install-nqrbp   rhods-operator.2.10.0   Manual     true
install-st8vh   rhods-operator.2.11.0   Manual     false
```

Assuming the install plan exists you can begin the upgrade process.

First, update the MLBatch modifications to the default RHOAI configuration maps.
```sh
oc apply -f setup.RHOAI-v2.11/mlbatch-upgrade-configmaps.yaml
```

Second, approve the install plan replacing the example plan name below with the actual
value on your cluster:
```sh
oc patch ip -n redhat-ods-operator --type merge --patch '{"spec":{"approved":true}}' install-st8vh
```
