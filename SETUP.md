# MLBatch Setup

The MLBatch setup consists of a *cluster setup* to be done once
and a *team setup* to be repeated for each team that will
be using the cluster.

Batch users should only be permitted to create AppWrappers or other
workload Kinds that are natively supported by Kueue. The cluster setup
defines a `mlbatch-edit` role which enforces these restrictions and
will be used in the setup process for each team of MLBatch users that
is onboarded.

This setup has been developed on Red Hat OpenShift 4.14 and Kubernetes 1.27 and
is intended to support Red Hat OpenShift 4.14 and up and/or Kubernetes 1.27 and up.

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
+ Red Hat OpenShift AI 2.13
   + [RHOAI 2.13 Cluster Setup](./setup.RHOAI-v2.13/CLUSTER-SETUP.md)
   + [RHOAI 2.13 Team Setup](./setup.RHOAI-v2.13/TEAM-SETUP.md)
   + [UPGRADING from RHOAI 2.10](./setup.RHOAI-v2.13/UPGRADE-STABLE.md)
   + [UPGRADING from RHOAI 2.12](./setup.RHOAI-v2.13/UPGRADE-FAST.md)
   + [RHOAI 2.13 Uninstall](./setup.RHOAI-v2.13/UNINSTALL.md)
+ Red Hat OpenShift AI 2.10
   + [RHOAI 2.10 Cluster Setup](./setup.RHOAI-v2.10/CLUSTER-SETUP.md)
   + [RHOAI 2.10 Team Setup](./setup.RHOAI-v2.10/TEAM-SETUP.md)
   + [RHOAI 2.10 Uninstall](./setup.RHOAI-v2.10/UNINSTALL.md)

Instructions are provided for the following Red Hat OpenShift AI ***fast*** releases:
+ Red Hat OpenShift AI 2.11
   + [RHOAI 2.11 Cluster Setup](./setup.RHOAI-v2.11/CLUSTER-SETUP.md)
   + [RHOAI 2.11 Team Setup](./setup.RHOAI-v2.11/TEAM-SETUP.md)
   + [UPGRADING from RHOAI 2.10](./setup.RHOAI-v2.11/UPGRADE.md)
   + [RHOAI 2.11 Uninstall](./setup.RHOAI-v2.11/UNINSTALL.md)

## Kubernetes

On Kubernetes version 1.30 and later, an enhanced user experience is
available by using ValidatingAdmissionPolicies to streamline quota
enforcement. Follow these instructions when installing on 1.30+ clusters:
   + [Kubernetes 1.30+ Cluster Setup](./setup.k8s-v1.30/CLUSTER-SETUP.md)
   + [Kubernetes 1.30+ Team Setup](./setup.k8s-v1.30/TEAM-SETUP.md)
   + [Kubernetes 1.30+ Uninstall](setup.k8s-v1.30/UNINSTALL.md)

MLBatch can be installed on any Kubernetes cluster version 1.27 or later
by following these instructions:
   + [Kubernetes Cluster Setup](./setup.k8s-v1.27/CLUSTER-SETUP.md)
   + [Kubternets Team Setup](./setup.k8s-v1.27/TEAM-SETUP.md)
   + [Kubernetes Uninstall](setup.k8s-v1.27/UNINSTALL.md)
