# MLBatch

This repository describes the [setup](SETUP.md) and [use](USAGE.md) of the
MLBatch queuing and quota management system on OpenShift clusters. MLBatch
leverages [Kueue](https://kueue.sigs.k8s.io), the [Kubeflow Training
Operator](https://www.kubeflow.org/docs/components/training/),
[KubeRay](https://docs.ray.io/en/latest/cluster/kubernetes/index.html), and the
[Codeflare Operator](https://github.com/project-codeflare/codeflare-operator)
from [Red Hat OpenShift
AI](https://www.redhat.com/en/technologies/cloud-computing/openshift/openshift-ai).
MLBatch enables [AppWrappers](https://project-codeflare.github.io/appwrapper/)
and adds
[Coscheduler](https://github.com/kubernetes-sigs/scheduler-plugins/blob/master/pkg/coscheduling/README.md).
MLBatch includes a number of configuration steps to help these components work
in harmony and support large workloads on large clusters.

MLBatch handles the queuing and dispatching of batch workloads on OpenShift
clusters. It enforces team quotas at the namespace level. It automates the
borrowing and reclamation of unused quotas across teams. Teams can use
priorities within their namespaces without impact on other teams. Using
AppWrappers to submit workloads activates a number of fault detection and
recovery capabilities, including automatically detecting failed pods and
automatically retrying failed workloads. Coscheduler supports gang scheduling
and minimizes fragmentation by preferentially packing jobs requiring less than a
full node's worth of GPUs together.

## Cluster Setup

To learn how to setup MLBatch on a cluster and onboard teams see
[SETUP.md](SETUP.md).

## Quick Start

To learn how to use MLBatch to run workloads see [USAGE.md](USAGE.md).

### PyTorchJobs via the MLBatch Helm Chart

Properly configuring a distributed `PyTorchJob` to make effective use of the
MLBatch system and hardware accelerators (GPUs, RoCE GDR) can be tedious. To
automate this process, we provide a Helm chart that captures best practices and
common configuration options. Using this Helm chart helps eliminate common
mistakes. Please see [pytorchjob-generator](tools/pytorchjob-generator) for
detailed usage instructions.

## Development Setup

If you will be contributing to the development of the MLBatch project, you must
setup precommit hooks for your local clone of the repository. Do the following
once, immediately after cloning this repo:
```shell
helm plugin install https://github.com/helm-unittest/helm-unittest.git
pre-commit install
```

## License

Copyright 2024 IBM Corporation.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
