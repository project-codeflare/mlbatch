# MLBatch Tutorial

In this tutorial, we walk through all the steps necessary to setup MLBatch on a
Kubernetes cluster and run a few example workloads. Prior to the [cluster
setup](../setup.k8s/CLUSTER-SETUP.md), we will configure storage classes and
Prometheus. We will configure team `blue` with user `alice` and `red` with user
`bob` following the [team setup](../setup.k8s/TEAM-SETUP.md).

## Cluster Characteristics

Our target cluster comprises three control planes nodes and three worker nodes
running Kubernetes 1.29 (from  OpenShift 4.16.36).
```sh
kubectl get nodes
```
```
NAME               STATUS   ROLES                  AGE     VERSION
pokprod-b93r38s3   Ready    worker                 5d13h   v1.29.11+148a389
pokprod-b93r39s2   Ready    worker                 5d12h   v1.29.11+148a389
pokprod-b93r44s0   Ready    worker                 5d13h   v1.29.11+148a389
pokprod002ctrl0    Ready    control-plane,master   5d15h   v1.29.11+148a389
pokprod002ctrl1    Ready    control-plane,master   5d15h   v1.29.11+148a389
pokprod002ctrl2    Ready    control-plane,master   5d15h   v1.29.11+148a389
```
Each worker node is equipped with eight H100 NVIDIA gpus.
```sh
kubectl describe node pokprod-b93r38s3
```
```
Name:               pokprod-b93r38s3
Roles:              worker
Labels:             beta.kubernetes.io/arch=amd64
...
                    nvidia.com/gpu.product=NVIDIA-H100-80GB-HBM3
...
                    nvidia.com/gpu.count=8
...
Capacity:
  cpu:                                       224
  ephemeral-storage:                         1873933640Ki
  hugepages-1Gi:                             0
  hugepages-2Mi:                             0
  memory:                                    2113411308Ki
  nvidia.com/gpu:                            8
  openshift.io/p0_storage_sriov_nodepolicy:  8
  pods:                                      250
  rdma/roce_gdr:                             0
...
```
For this tutorial, we assume the [NVIDIA GPU
operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/index.html)
is already
[installed](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/getting-started.html)
on the cluster. While this cluster is capable of [GPU-direct RDMA (GDR) with
ROCE (RDMA over Converged
Ethernet)](https://medium.com/@sunyanan.choochotkaew1/unlocking-gpudirect-rdma-on-roce-in-kubernetes-based-cluster-on-cloud-through-multi-nic-cni-1e69ffb96296),
we will not cover advanced networking topics in this tutorial and disable this
feature.

## MLBatch Setup

### Storage Setup

We assume storage is available by means of preconfigured
[NFS](https://en.wikipedia.org/wiki/Network_File_System) servers. We configure
two storage classes using the [NFS Subdir External
Provisioner](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner).
```sh
helm repo add nfs-subdir-external-provisioner https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner
helm repo update

helm install -n nfs-provisioner simplenfs nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
  --create-namespace \
  --set nfs.server=192.168.95.253 --set nfs.path=/var/repo/root/nfs \
  --set storageClass.name=nfs-client-simplenfs --set storageClass.provisionerName=k8s-sigs.io/simplenfs-nfs-subdir-external-provisioner

helm install -n nfs-provisioner pokprod nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
  --create-namespace \
  --set nfs.server=192.168.98.96 --set nfs.path=/gpfs/fs_ec/pokprod002 \
  --set storageClass.name=nfs-client-pokprod --set storageClass.provisionerName=k8s-sigs.io/pokprod-nfs-subdir-external-provisioner
```
Make sure to replace the server ips and paths above with the right values for
your environment. While we make use of both storage classes in the remainder of
the tutorial for the sake of demonstration, everything could be done with a
single class.
```sh
kubectl get storageclasses
```
```
NAME                   PROVISIONER                                             RECLAIMPOLICY   VOLUMEBINDINGMODE   ALLOWVOLUMEEXPANSION   AGE
nfs-client-pokprod     k8s-sigs.io/pokprod-nfs-subdir-external-provisioner     Delete          Immediate           true                   11s
nfs-client-simplenfs   k8s-sigs.io/simplenfs-nfs-subdir-external-provisioner   Delete          Immediate           true                   15s
```

### Prometheus Setup

TODO

### MLBatch Cluster Setup

We follow instructions from [CLUSTER-SETUP.md](../setup.k8s/CLUSTER-SETUP.md). 

```sh
# Clone MLBatch repository
git clone --recursive https://github.com/project-codeflare/mlbatch.git
cd mlbatch

# Setup priority classes
kubectl apply -f setup.k8s/mlbatch-priorities.yaml

# Deploy scheduler plugins
helm install scheduler-plugins --namespace scheduler-plugins --create-namespace scheduler-plugins/manifests/install/charts/as-a-second-scheduler/ --set-json pluginConfig='[{"args":{"s
coringStrategy":{"resources":[{"name":"nvidia.com/gpu","weight":1}],"requestedToCapacityRatio":{"shape":[{"utilization":0,"score":0},{"utilization":100,"score":10}]},"type":"RequestedToCapacityR
atio"}},"name":"NodeResourcesFit"},{"args":{"permitWaitingTimeSeconds":300},"name":"Coscheduling"}]'

# Wait for scheduler-plugins pods to be running
kubectl get pods -n scheduler-plugins

# Patch scheduler-plugins pod priorities
kubectl patch deployment -n scheduler-plugins --type=json --patch-file setup.k8s/scheduler-priority-patch.yaml scheduler-plugins-controller
kubectl patch deployment -n scheduler-plugins --type=json --patch-file setup.k8s/scheduler-priority-patch.yaml scheduler-plugins-scheduler

# Create mlbatch-system namespace
kubectl create namespace mlbatch-system

# Deploy Kubeflow training operator
kubectl apply --server-side -k setup.k8s/training-operator/coscheduling

# Deploy Kuberay
kubectl apply --server-side -k setup.k8s/kuberay

# Deploy Kueue
kubectl apply --server-side -k setup.k8s/kueue

# Wait for Kueue to be running
kubectl get pods -n mlbatch-system

# Deploy AppWrapper
kubectl apply --server-side -k setup.k8s/appwrapper/coscheduling

# Deploy Autopilot
helm repo add autopilot https://ibm.github.io/autopilot/
helm repo update

helm upgrade autopilot autopilot/autopilot --install -n autopilot --create-namespace

kubectl label servicemonitors -n autopilot autopilot-metrics-monitor release=kube-prometheus-stack --overwrite

# Create Kueue's default flavor
kubectl apply -f setup.k8s/default-flavor.yaml

# Setup mlbatch-edit-role
kubectl apply -f setup.k8s/mlbatch-edit-role.yaml

# Create slack cluster queue with 8 gpus
kubectl apply -f- << EOF
apiVersion: kueue.x-k8s.io/v1beta1
kind: ClusterQueue
metadata:
  name: slack-cluster-queue
spec:
  namespaceSelector: {}
  cohort: default-cohort
  preemption:
    withinClusterQueue: LowerOrNewerEqualPriority
    reclaimWithinCohort: Any
    borrowWithinCohort:
      policy: Never
  resourceGroups:
  - coveredResources: ["cpu", "memory", "nvidia.com/gpu", "pods"]
    flavors:
    - name: default-flavor
      resources:
      - name: "cpu"
        nominalQuota: 224
      - name: "memory"
        nominalQuota: 2000G
      - name: "nvidia.com/gpu"
        nominalQuota: 8
      - name: "pods"
        nominalQuota: 100
EOF
```
We reserve 8 GPUs out of 24 for MLBatch's slack queue.

### Autopilot Extended Setup

TODO

### MLBatch Teams Setup

We configure team `blue` with user `alice` and `red` with user `bob` following
the [team setup](../setup.k8s/TEAM-SETUP.md). Each team has a nominal quota of
eight GPUs.
```sh
# Create namespaces
kubectl create ns blue
kubectl create ns red

kubectl label namespace blue mlbatch-team-namespace=true
kubectl label namespace red mlbatch-team-namespace=true

# Create queues
kubectl -n blue apply -f- << EOF
apiVersion: kueue.x-k8s.io/v1beta1
kind: ClusterQueue
metadata:
  name: blue-cluster-queue
spec:
  namespaceSelector: {}
  cohort: default-cohort
  preemption:
    withinClusterQueue: LowerOrNewerEqualPriority
    reclaimWithinCohort: Any
    borrowWithinCohort:
      policy: Never
  resourceGroups:
  - coveredResources: ["cpu", "memory", "nvidia.com/gpu", "pods"]
    flavors:
    - name: default-flavor
      resources:
      - name: "cpu"
        nominalQuota: 224
      - name: "memory"
        nominalQuota: 2000G
      - name: "nvidia.com/gpu"
        nominalQuota: 8
      - name: "pods"
        nominalQuota: 100
EOF

kubectl apply -n blue -f- << EOF
apiVersion: kueue.x-k8s.io/v1beta1
kind: LocalQueue
metadata:
  name: default-queue
spec:
  clusterQueue: blue-cluster-queue
EOF

kubectl apply -n red -f- << EOF
apiVersion: kueue.x-k8s.io/v1beta1
kind: ClusterQueue
metadata:
  name: red-cluster-queue
spec:
  namespaceSelector: {}
  cohort: default-cohort
  preemption:
    withinClusterQueue: LowerOrNewerEqualPriority
    reclaimWithinCohort: Any
    borrowWithinCohort:
      policy: Never
  resourceGroups:
  - coveredResources: ["cpu", "memory", "nvidia.com/gpu", "pods"]
    flavors:
    - name: default-flavor
      resources:
      - name: "cpu"
        nominalQuota: 224
      - name: "memory"
        nominalQuota: 2000G
      - name: "nvidia.com/gpu"
        nominalQuota: 8
      - name: "pods"
        nominalQuota: 100
EOF

kubectl apply -n red -f- << EOF
apiVersion: kueue.x-k8s.io/v1beta1
kind: LocalQueue
metadata:
  name: default-queue
spec:
  clusterQueue: red-cluster-queue
EOF

# Authorize alice and bob in their respective namespaces
kubectl -n blue apply -f- << EOF
kind: RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
metadata:
  name: alice
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: User
    name: alice
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: mlbatch-edit
EOF

kubectl -n red apply -f- << EOF
kind: RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
metadata:
  name: bob
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: User
    name: bob
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: mlbatch-edit
EOF
```
While we gave permissions to Kubernetes users `alice` and `bob`, we have not
tied these names to any identity provider as the details of this setup are not
portable. In this tutorial, we will rely on [user
impersonation](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#user-impersonation)
with `kubectl` to run as a specific user.

## Example Workloads

Each example workload below is submitted as an
[AppWrapper](https://project-codeflare.github.io/appwrapper/). See
[USAGE.md](../USAGE.md) for a detailed discussion of queues and workloads in an
MLBatch cluster.

### Batch Inference with vLLM

In this example, `alice` runs a batch inference workload using
[vLLM](https://docs.vllm.ai/en/latest/) to serve IBM's
[granite-3.2-8b-instruct](https://huggingface.co/ibm-granite/granite-3.2-8b-instruct)
model.

First, `alice` creates a persistent volume claim to cache the model weights on
first invocation so that subsequent instantiation of the model will reuse the
cached data.
```yaml
kubectl apply --as alice -n blue -f- << EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: granite-3.2-8b-instruct
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 50Gi
  storageClassName: nfs-client-pokprod
EOF
```
The workload wraps a Kubernetes Job in an AppWrapper. The Job consists of one
Pod with two containers using an upstream `vllm-openai` image. The `vllm`
container runs the inference runtime. The `load-generator` container submits a
random series of requests to the inference runtime and reports a number of
metrics such as _Time to First Token_ (TTFT) and _Time per Output Token_ (TPOT).
```yaml
kubectl apply --as alice -n blue -f- << EOF
apiVersion: workload.codeflare.dev/v1beta2
kind: AppWrapper
metadata:
  name: batch-inference
spec:
  components:
  - template:
      apiVersion: batch/v1
      kind: Job
      metadata:
        name: batch-inference
      spec:
        template:
          metadata:
            annotations:
              kubectl.kubernetes.io/default-container: load-generator
            labels:
              app: batch-inference
          spec:
            terminationGracePeriodSeconds: 0
            restartPolicy: Never
            containers:
              - name: vllm
                image: quay.io/tardieu/vllm-openai:v0.7.3 # mirror of vllm/vllm-openai:v0.7.3
                command:
                  # serve model and wait for halt signal
                  - sh
                  - -c
                  - |
                    vllm serve ibm-granite/granite-3.2-8b-instruct &
                    until [ -f /.config/halt ]; do sleep 1; done
                ports:
                  - containerPort: 8000
                resources:
                  requests:
                    cpu: 4
                    memory: 64Gi
                    nvidia.com/gpu: 1
                  limits:
                    cpu: 4
                    memory: 64Gi
                    nvidia.com/gpu: 1
                volumeMounts:
                  - name: cache
                    mountPath: /.cache
                  - name: config
                    mountPath: /.config
              - name: load-generator
                image: quay.io/tardieu/vllm-benchmarks:v0.7.3
                command:
                  # wait for vllm, submit batch of inference requests, send halt signal
                  - sh
                  - -c
                  - |
                    until nc -zv localhost 8000; do sleep 1; done;
                    python3 benchmark_serving.py \
                      --model=ibm-granite/granite-3.2-8b-instruct \
                      --backend=vllm \
                      --dataset-name=random \
                      --random-input-len=128 \
                      --random-output-len=128 \
                      --max-concurrency=16 \
                      --num-prompts=512;
                    touch /.config/halt
                volumeMounts:
                  - name: cache
                    mountPath: /.cache
                  - name: config
                    mountPath: /.config
            volumes:
              - name: cache
                persistentVolumeClaim:
                  claimName: granite-3.2-8b-instruct
              - name: config
                emptyDir: {}
EOF
```
The two containers are synchronized as follows: `load-generator` waits for
`vllm` to be ready to accept requests and, upon completion of the batch, signals
`vllm` to make it quit.

## Pre-Training with PyTorch

TODO
