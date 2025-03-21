# MLBatch Tutorial

MLBatch is the software stack we developed in IBM Research to facilitate the
setup, administration, and use of Kubernetes clusters dedicated to batch AI/ML
workloads. It leverages a number of community projects such as
[Kueue](https://kueue.sigs.k8s.io), [Kubeflow
Trainer](https://www.kubeflow.org/docs/components/training/),
[KubeRay](https://docs.ray.io/en/latest/cluster/kubernetes/index.html), and
[vLLM](https://docs.vllm.ai/en/latest/). It complements them with several
open-source components born in IBM Research including
[AutoPilot](https://github.com/IBM/autopilot),
[AppWrapper](https://project-codeflare.github.io/appwrapper/), and
[Sakkara](https://github.com/atantawi/4986-kep-sakkara). MLBatch manages teams,
queues, quotas, and resource allocation. It monitors key cluster components,
detecting faults and to a degree automating fault recovery.

In this tutorial, we walk through all the steps necessary to setup MLBatch on a
Kubernetes cluster and run a few example workloads.
- We configure persistent storage using
[NFS](https://en.wikipedia.org/wiki/Network_File_System).
- We deploy MLBatch following the
  [CLUSTER-SETUP.md](../setup.k8s/CLUSTER-SETUP.md) instructions.
- We configure example teams following the
  [TEAM-SETUP.md](../setup.k8s/TEAM-SETUP.md) instructions.
- We reconfigure Autopilot to periodically assess the storage class in addition
  to running network and GPU tests. _This is optional._
- We deploy [Prometheus](https://prometheus.io) and [Grafana
dashboards](https://grafana.com/grafana/dashboards/) to monitor the health of
the cluster and GPU utilization. _This is optional._
- We demonstrate the queuing, quota management, and fault recovery capabilities
  of MLBatch using synthetic workloads.
- We run example workloads using vLLM, PyTorch, and Ray.

## Cluster Characteristics

Our target cluster comprises three control planes nodes and three worker nodes
running Kubernetes 1.29, specifically [OpenShift
4.16](https://docs.openshift.com/container-platform/4.16/release_notes/ocp-4-16-release-notes.html).

<details>

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
Each worker node is equipped with eight [NVIDIA
H100](https://www.nvidia.com/en-us/data-center/h100/) GPUs.
```sh
oc debug node/pokprod-b93r38s3 -- chroot /host lspci -d 10de:
```
```
Starting pod/pokprod-b93r38s3-debug-4bv4j ...
To use host binaries, run `chroot /host`
05:00.0 Bridge: NVIDIA Corporation GH100 [H100 NVSwitch] (rev a1)
06:00.0 Bridge: NVIDIA Corporation GH100 [H100 NVSwitch] (rev a1)
07:00.0 Bridge: NVIDIA Corporation GH100 [H100 NVSwitch] (rev a1)
08:00.0 Bridge: NVIDIA Corporation GH100 [H100 NVSwitch] (rev a1)
18:00.0 3D controller: NVIDIA Corporation GH100 [H100 SXM5 80GB] (rev a1)
2a:00.0 3D controller: NVIDIA Corporation GH100 [H100 SXM5 80GB] (rev a1)
3a:00.0 3D controller: NVIDIA Corporation GH100 [H100 SXM5 80GB] (rev a1)
5d:00.0 3D controller: NVIDIA Corporation GH100 [H100 SXM5 80GB] (rev a1)
9a:00.0 3D controller: NVIDIA Corporation GH100 [H100 SXM5 80GB] (rev a1)
ab:00.0 3D controller: NVIDIA Corporation GH100 [H100 SXM5 80GB] (rev a1)
ba:00.0 3D controller: NVIDIA Corporation GH100 [H100 SXM5 80GB] (rev a1)
db:00.0 3D controller: NVIDIA Corporation GH100 [H100 SXM5 80GB] (rev a1)

Removing debug pod ...
```
For this tutorial, we assume the [NVIDIA GPU
operator](https://docs.nvidia.com/datacenter/cloud-native/GPU-operator/latest/index.html)
is already
[installed](https://docs.nvidia.com/datacenter/cloud-native/GPU-operator/latest/getting-started.html)
on the cluster. While this cluster is capable of [GPU-direct RDMA (GDR) with
ROCE (RDMA over Converged
Ethernet)](https://medium.com/@sunyanan.choochotkaew1/unlocking-GPUdirect-rdma-on-roce-in-kubernetes-based-cluster-on-cloud-through-multi-nic-cni-1e69ffb96296),
we will not cover or rely on advanced networking configurations in this
tutorial.
```sh
kubectl get operators -A
```
```
NAME                                         AGE
gpu-operator-certified.nvidia-gpu-operator   18h
nfd.openshift-nfd                            18h
```
```sh
kubectl get node pokprod-b93r38s3 -o yaml | yq .status.capacity
```
```
cpu: "224"
ephemeral-storage: 1873933640Ki
hugepages-1Gi: "0"
hugepages-2Mi: "0"
memory: 2113411288Ki
nvidia.com/gpu: "8"
pods: "250"
```


</details>

## Persistent Storage Setup

We assume storage is available by means of a preexisting
[NFS](https://en.wikipedia.org/wiki/Network_File_System) server. We configure
one storage class using the [NFS Subdir External
Provisioner](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner).

<details>

```sh
helm repo add nfs-subdir-external-provisioner https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner
helm repo update

helm install -n nfs-provisioner pokprod nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
  --create-namespace \
  --set nfs.server=192.168.98.96 \
  --set nfs.path=/gpfs/fs_ec/pokprod002 \
  --set storageClass.name=nfs-client-pokprod \
  --set storageClass.provisionerName=k8s-sigs.io/pokprod-nfs-subdir-external-provisioner
```
Make sure to set the `nfs.server` and `nfs.path` values to the right values for
your environment.
```sh
kubectl get storageclasses
```
```
NAME                   PROVISIONER                                             RECLAIMPOLICY   VOLUMEBINDINGMODE   ALLOWVOLUMEEXPANSION   AGE
nfs-client-pokprod     k8s-sigs.io/pokprod-nfs-subdir-external-provisioner     Delete          Immediate           true                   11s
```
OpenShift clusters require an additional configuration step to permit the
provisioner pod to mount the storage volume.
```sh
oc adm policy add-scc-to-user hostmount-anyuid \
  system:serviceaccount:nfs-provisioner:pokprod-nfs-subdir-external-provisioner
```

</details>

## MLBatch Cluster Setup

We deploy MLBatch to the cluster following
[CLUSTER-SETUP.md](../setup.k8s/CLUSTER-SETUP.md).

<details>

```sh
# Clone MLBatch repository
git clone --recursive https://github.com/project-codeflare/mlbatch.git
cd mlbatch

# Setup priority classes
kubectl apply -f setup.k8s/mlbatch-priorities.yaml

# Deploy scheduler-plugins
helm install scheduler-plugins -n scheduler-plugins --create-namespace \
  scheduler-plugins/manifests/install/charts/as-a-second-scheduler/ \
  --set-json pluginConfig='[{"args":{"scoringStrategy":{"resources":[{"name":"nvidia.com/gpu","weight":1}],"requestedToCapacityRatio":{"shape":[{"utilization":0,"score":0},{"utilization":100,"score":10}]},"type":"RequestedToCapacityRatio"}},"name":"NodeResourcesFit"},{"args":{"permitWaitingTimeSeconds":300},"name":"Coscheduling"}]'

# Patch scheduler-plugins pod priorities
kubectl patch deployment -n scheduler-plugins --type=json \
  --patch-file setup.k8s/scheduler-priority-patch.yaml scheduler-plugins-controller
kubectl patch deployment -n scheduler-plugins --type=json \
  --patch-file setup.k8s/scheduler-priority-patch.yaml scheduler-plugins-scheduler

# Wait for scheduler-plugins pods to be ready
kubectl -n scheduler-plugins wait --timeout=300s --for=condition=Available deployments --all

# Create mlbatch-system namespace
kubectl create namespace mlbatch-system

# Deploy Kubeflow training operator
kubectl apply --server-side -k setup.k8s/training-operator/coscheduling

# Deploy KubeRay
kubectl apply --server-side -k setup.k8s/kuberay

# Deploy Kueue
kubectl apply --server-side -k setup.k8s/kueue

# Wait for Kueue to be ready
kubectl -n mlbatch-system wait --timeout=300s --for=condition=Available deployments kueue-controller-manager

# Deploy AppWrapper
kubectl apply --server-side -k setup.k8s/appwrapper/coscheduling

# Deploy Autopilot
helm repo add autopilot https://ibm.github.io/autopilot/
helm repo update

helm upgrade -i autopilot -n autopilot autopilot/autopilot --create-namespace

# Create Kueue's default flavor
kubectl apply -f setup.k8s/default-flavor.yaml

# Setup mlbatch-edit-role
kubectl apply -f setup.k8s/mlbatch-edit-role.yaml
```
We reserve 8 GPUs out of 24 for MLBatch's slack queue.
```yaml
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

</details>

## MLBatch Teams Setup

We configure team `blue` with user `alice` and `red` with user `bob` following
[TEAM-SETUP.md](../setup.k8s/TEAM-SETUP.md). Each team has a nominal quota of 8
GPUs.

<details>

For `alice` in team `blue`:
```yaml
# Create namespaces
kubectl create ns blue

# Label namespace
kubectl label namespace blue mlbatch-team-namespace=true

# Create cluster queue
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

# Create default queue for namespace
kubectl apply -n blue -f- << EOF
apiVersion: kueue.x-k8s.io/v1beta1
kind: LocalQueue
metadata:
  name: default-queue
spec:
  clusterQueue: blue-cluster-queue
EOF

# Authorize alice
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
```
For `bob` in team `red`:
```yaml
kubectl create ns red

kubectl label namespace red mlbatch-team-namespace=true

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

</details>

## Extended Autopilot Setup

Optionally, we configure Autopilot to test PVC creation and deletion with the
`nfs-client-pokprod` storage class.

<details>

First create the extended Autopilot configuration.
```sh
cat << EOF > autopilot-extended.yaml
env:
  - name: "PERIODIC_CHECKS"
    value: "pciebw,remapped,dcgm,ping,gpupower,pvc"
  - name: "PVC_TEST_STORAGE_CLASS"
    value: "nfs-client-pokprod"
EOF
```
Then reapply the helm chart, this will start a rollout update.
```sh
helm upgrade -i autopilot autopilot/autopilot -n autopilot --create-namespace -f autopilot-extended.yaml
```

</details>

## Monitoring Setup

Optionally, we deploy [Prometheus](https://prometheus.io) and [Grafana
dashboards](https://grafana.com/grafana/dashboards/) to the cluster.

<details>

We follow the setup provided by the `prometheus-community/kube-prometheus-stack`
Helm chart.

```sh
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts && helm repo update
```

The charts will install: Prometheus, Grafana, Alert Manager, Prometheus Node
Exporter and Kube State Metrics. We set up the chart with the following:

- Persistent storage for Prometheus, Grafana and Alert Manager;
- Override the Prometheus Node Exporter port;
- Disable CRDs creation as they are already present.

You may leave the CRDs creation on, along with the default Node Exporter pod.
These changes are needed when deploying a separate Prometheus instance in
OpenShift.

```sh
cat << EOF > config.yaml
crds:
  enabled: false

prometheus-node-exporter:
  service:
    port: 9110

alertmanager:
  alertmanagerSpec:
    persistentVolumeClaimRetentionPolicy:
      whenDeleted: Retain
      whenScaled: Retain
    storage:
      volumeClaimTemplate:
        spec:
          storageClassName: nfs-client-pokprod
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 50Gi

prometheus:
  prometheusSpec:
    persistentVolumeClaimRetentionPolicy:
      whenDeleted: Retain
      whenScaled: Retain
    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: nfs-client-pokprod
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 50Gi
    emptyDir:
      medium: Memory

grafana:
  persistence:
    enabled: true
    type: sts
    storageClassName: "nfs-client-pokprod"
    accessModes:
      - ReadWriteOnce
    size: 20Gi
    finalizers:
      - kubernetes.io/pvc-protection
EOF

helm upgrade -i kube-prometheus-stack -n prometheus prometheus-community/kube-prometheus-stack --create-namespace -f config.yaml
```

If deploying on OpenShift based systems, you need to assign the privileged
security context to the service accounts that are created by the helm chart.

```sh
oc adm policy add-scc-to-user privileged system:serviceaccount:prometheus:kube-prometheus-stack-admission system:serviceaccount:prometheus:kube-prometheus-stack-alertmanager system:serviceaccount:prometheus:kube-prometheus-stack-grafana system:serviceaccount:prometheus:kube-prometheus-stack-kube-state-metrics system:serviceaccount:prometheus:kube-prometheus-stack-operator system:serviceaccount:prometheus:kube-prometheus-stack-prometheus system:serviceaccount:prometheus:kube-prometheus-stack-prometheus-node-exporter
```

You should expect the following pods:

```sh
kubectl get pods
```
```sh
NAME                                                        READY   STATUS    RESTARTS   AGE
alertmanager-kube-prometheus-stack-alertmanager-0           2/2     Running   0          16m
kube-prometheus-stack-grafana-0                             3/3     Running   0          16m
kube-prometheus-stack-kube-state-metrics-6f76b98d89-pxs69   1/1     Running   0          16m
kube-prometheus-stack-operator-7fbfc985bb-mm9bk             1/1     Running   0          16m
kube-prometheus-stack-prometheus-node-exporter-44llp        1/1     Running   0          16m
kube-prometheus-stack-prometheus-node-exporter-95gp8        1/1     Running   0          16m
kube-prometheus-stack-prometheus-node-exporter-dxf5f        1/1     Running   0          16m
kube-prometheus-stack-prometheus-node-exporter-f45dx        1/1     Running   0          16m
kube-prometheus-stack-prometheus-node-exporter-pfrzk        1/1     Running   0          16m
kube-prometheus-stack-prometheus-node-exporter-zpfzb        1/1     Running   0          16m
prometheus-kube-prometheus-stack-prometheus-0               2/2     Running   0          16m
```

To access the Grafana dashboard on `localhost:3000`:

```sh
kubectl -n prometheus get secrets kube-prometheus-stack-grafana -o jsonpath="{.data.admin-password}" | base64 -d ; echo
```
```sh
export POD_NAME=$(kubectl -n prometheus get pod -l "app.kubernetes.io/name=grafana,app.kubernetes.io/instance=kube-prometheus-stack" -oname)
  kubectl -n prometheus port-forward $POD_NAME 3000
```

To import NVidia and Autopilot metrics, from the Grafana dashboard:

- Select the `+` drop down menu on the top right, and **Import dashboard**
- In the `Grafana.com dashboard URL or ID` box, add
  [https://grafana.com/grafana/dashboards/23123-autopilot-metrics/](https://grafana.com/grafana/dashboards/23123-autopilot-metrics/)
  and click Load, then repeat with the NVidia dashboard
  [https://grafana.com/grafana/dashboards/12239-nvidia-dcgm-exporter-dashboard/](https://grafana.com/grafana/dashboards/12239-nvidia-dcgm-exporter-dashboard/)

To visualize the metrics, we need to label the service monitor objects in both
`autopilot` and `nvidia-GPU-operator` namespaces with the Prometheus release
name.

```sh
kubectl label servicemonitors.monitoring.coreos.com -n autopilot autopilot-metrics-monitor release=kube-prometheus-stack --overwrite
```
```sh
kubectl label servicemonitors.monitoring.coreos.com -n nvidia-GPU-operator nvidia-dcgm-exporter GPU-operator nvidia-node-status-exporter  release=kube-prometheus-stack --overwrite
```

</details>

## Workload Management

We will now demonstrate the queueing, quota management, and fault recovery
capabilities of MLBatch using synthetic workloads.

<details>

TODO

</details>

## Example Workloads

We now will now run some sample workloads that are representative of what is run
on an AI GPU Cluster.

### Batch Inference with vLLM

In this example, `alice` runs a batch inference workload using
[vLLM](https://docs.vllm.ai/en/latest/) to serve IBM's
[granite-3.2-8b-instruct](https://huggingface.co/ibm-granite/granite-3.2-8b-instruct)
model.

<details>

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

</details>

### Pre-Training with PyTorch

In this example, `alice` uses the [Kubeflow Training
Operator](https://github.com/kubeflow/training-operator) to run a job that uses
[PyTorch](https://pytorch.org) to train a machine learning model.

<details>

TODO

</details>

### Fine-Tuning with Ray

In this example, `alice` uses [KubeRay](https://github.com/ray-project/kuberay)
to run a job that uses [Ray](https://github.com/ray-project/ray) to fine tune a
machine learning model.

<details>

TODO

</details>
