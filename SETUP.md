# MLBatch Setup

The MLBatch setup consists of a *cluster setup* to be done once
and a *team setup* to be repeated for each team that will
be using the cluster.

Batch users should only be permitted to create AppWrappers or other
workload Kinds that are natively supported by Kueue. The cluster setup
defines a `mlbatch-edit` role which enforces these restrictions and
will be used in the setup process for each team of MLBatch users that
is onboarded.

This setup has been developed on Red Hat OpenShift 4.14, Red Hat OpenShift 4.16,
and Kubernetes 1.29 and is intended to support Red Hat OpenShift 4.14 and up
and/or Kubernetes 1.29 and up.

To start with, recursively clone and enter this repository:
```sh
git clone --recursive https://github.com/project-codeflare/mlbatch.git
cd mlbatch
```

Detailed instructions and configuration files can be found in subfolders,
one for each base platform.

## Red Hat OpenShift AI

We recommend using the most recent ***stable*** release of
Red Hat OpenShift AI as the base platform for MLBatch. Please see
[Red Hat OpenShift AI Self-Managed Life Cycle](https://access.redhat.com/support/policy/updates/rhoai-sm/lifecycle)
for the life cycle dates of currently supported ***stable*** and ***fast*** releases.

Instructions are provided for the following Red Hat OpenShift AI ***stable*** releases:
+ Red Hat OpenShift AI 2.19
   + [RHOAI 2.19 Cluster Setup](./setup.RHOAI-v2.19/CLUSTER-SETUP.md)
   + [RHOAI 2.19 Team Setup](./setup.RHOAI-v2.19/TEAM-SETUP.md)
   + [UPGRADING from RHOAI 2.16](./setup.RHOAI-v2.19/UPGRADE-STABLE.md)
   + [UPGRADING from RHOAI 2.18](./setup.RHOAI-v2.19/UPGRADE-FAST.md)
   + [RHOAI 2.19 Uninstall](./setup.RHOAI-v2.19/UNINSTALL.md)
+ Red Hat OpenShift AI 2.16
   + [RHOAI 2.16 Cluster Setup](./setup.RHOAI-v2.16/CLUSTER-SETUP.md)
   + [RHOAI 2.16 Team Setup](./setup.RHOAI-v2.16/TEAM-SETUP.md)
   + [UPGRADING from RHOAI 2.13](./setup.RHOAI-v2.16/UPGRADE-STABLE.md)
   + [UPGRADING from RHOAI 2.15](./setup.RHOAI-v2.16/UPGRADE-FAST.md)
   + [RHOAI 2.16 Uninstall](./setup.RHOAI-v2.16/UNINSTALL.md)

Instructions are provided for the following Red Hat OpenShift AI ***fast*** releases:
+ Red Hat OpenShift AI 2.21
   + [RHOAI 2.21 Cluster Setup](./setup.RHOAI-v2.21/CLUSTER-SETUP.md)
   + [RHOAI 2.21 Team Setup](./setup.RHOAI-v2.21/TEAM-SETUP.md)
   + [UPGRADING from RHOAI 2.20](./setup.RHOAI-v2.21/UPGRADE-FAST.md)
   + [RHOAI 2.21 Uninstall](./setup.RHOAI-v2.21/UNINSTALL.md)
+ Red Hat OpenShift AI 2.20
   + [RHOAI 2.20 Cluster Setup](./setup.RHOAI-v2.20/CLUSTER-SETUP.md)
   + [RHOAI 2.20 Team Setup](./setup.RHOAI-v2.20/TEAM-SETUP.md)
   + [UPGRADING from RHOAI 2.19](./setup.RHOAI-v2.20/UPGRADE-FAST.md)
   + [RHOAI 2.20 Uninstall](./setup.RHOAI-v2.20/UNINSTALL.md)

## Kubernetes

MLBatch can be installed on any Kubernetes cluster version 1.29 or later
by following these instructions:
   + [Kubernetes Cluster Setup](./setup.k8s/CLUSTER-SETUP.md)
   + [Kubternets Team Setup](./setup.k8s/TEAM-SETUP.md)
   + [Kubernetes Uninstall](./setup.k8s/UNINSTALL.md)
