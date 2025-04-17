# PyTorchJob Generator

The Helm chart defined in this folder facilitates the configuration of PyTorch
jobs for submission to an OpenShift cluster implementing MLBatch.

Invocations of this chart generate a `PyTorchJob` wrapped into an `AppWrapper`
for better traceability and fault-tolerance.

## Obtaining the Chart

To start with, add the `mlbatch` Helm chart repository.
```sh
helm repo add mlbatch https://project-codeflare.github.io/mlbatch
helm repo update
```
To verify the chart was installed correctly, search for `AppWrapper`.
```sh
helm search repo AppWrapper
```
You should see output similar to the following:
```sh
NAME                        	CHART VERSION	APP VERSION	DESCRIPTION
mlbatch/pytorchjob-generator	1.1.9        	v1beta2    	An AppWrapper generator for PyTorchJobs
```

## Configuring the Job

Create a `settings.yaml` file with the settings for the PyTorch job, for
example:
```yaml
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
helm template -f settings.yaml mlbatch/pytorchjob-generator | oc create -f-
```
+
To optionally capture the generated `AppWrapper` specification as a
`generated.yaml` file, run instead:
```sh
helm template -f settings.yaml mlbatch/pytorchjob-generator | tee generated.yaml | oc create -f-
```

To remove the PyTorch job from the cluster, delete the generated `AppWrapper`
object:
```sh
oc delete appwrapper my-job
```
