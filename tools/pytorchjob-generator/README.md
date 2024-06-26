# PyTorchJob Generator

The Helm chart provided in this folder facilitates the configuration of PyTorch
jobs for submission to an OpenShift cluster implementing MLBatch.

Invocations of this chart generate a `PyTorchJob` wrapped into an `AppWrapper`
for better traceability and fault-tolerance.

## Obtaining the Chart

To start with, recursively clone and enter this repository:
```sh
git clone --recursive https://github.com/project-codeflare/mlbatch.git
cd mlbatch
```

## Configuring the Job

Create a `settings.yaml` file with the settings for the PyTorch job, for
example:
```yaml
namespace: my-namespace       # namespace to deploy to (required)
jobName: my-job               # name of the generated AppWrapper and PyTorchJob objects (required)
queueName: default-queue      # local queue to submit to (default: default-queue)

numPods: 4                    # total pod count including master and worker pods (default: 1)
numCpusPerPod: 500m           # requested number of cpus per pod (default: 1)
numGpusPerPod: 8              # requested number of gpus per pod (default: 0)
totalMemoryPerPod: 1Gi        # requested amount of memory per pod (default: 1Gi)

priority: default-priority    # default-priority (default), low-priority, or high-priority

# container image for the pods (required)
containerImage: ghcr.io/foundation-model-stack/base:pytorch-latest-nightly-20230126

# setup commands to run in each pod (optional)
setupCommands:                
- git clone https://github.com/dbarnett/python-helloworld
- cd python-helloworld

# main program to invoke via torchrun (optional)
mainProgram: helloworld.py
```

To learn more about the available settings see [chart/README.md](chart/README.md).

## Submitting the Job

To submit the Pytorch job to the cluster using the `settings.yaml` file, run:
```sh
helm template -f settings.yaml tools/pytorchjob-generator/chart | oc create -f-
```

To optionally capture the generated `AppWrapper` specification as a
`generated.yaml` file, run instead:
```sh
helm template -f settings.yaml tools/pytorchjob-generator/chart | tee generated.yaml | oc create -f-
```

To remove the PyTorch job from the cluster, delete the generated `AppWrapper`
object:
```sh
oc delete appwrapper -n my-namespace my-job
```
