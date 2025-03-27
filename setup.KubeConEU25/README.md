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
kubectl label servicemonitors.monitoring.coreos.com -n nvidia-gpu-operator nvidia-dcgm-exporter gpu-operator nvidia-node-status-exporter  release=kube-prometheus-stack --overwrite
```

</details>

## Workload Management

We will now demonstrate the queuing, quota management, and fault recovery capabilities of MLBatch
using synthetic workloads.

<details>
For this portion of the tutorial, we will use variations on the simple batch/v1 Job shown below.
All variations will create multiple pods, each requesting some number of GPUs, and sleep for
a specified interval before completing successfully.

```yaml
apiVersion: workload.codeflare.dev/v1beta2
kind: AppWrapper
metadata:
  generateName: <jobtype>
  labels:
    kueue.x-k8s.io/queue-name: default-queue
spec:
  components:
  - template:
      apiVersion: batch/v1
      kind: Job
      metadata:
        generateName: <jobtype>
      spec:
        completions: <number of pods>
        parallelism: <number of pods>
        template:
          spec:
            restartPolicy: Never
            terminationGracePeriodSeconds: 0
            priorityClassName: <priority class>
            containers:
            - name: busybox
              image: quay.io/project-codeflare/busybox:1.36
              command: ["sh", "-c", "sleep 600"]
              resources:
                limits:
                  nvidia.com/gpu: 4
```

We will use four types of jobs:

| Job Type | Priority | Duration | Number of Pods | GPU Usage  |
|----------|----------|----------|----------------|------------|
| short    | normal   | 30s      | 2              | 2 X 4 = 8  |
| normal   | normal   | 600s     | 2              | 2 X 4 = 8  |
| important| high     | 600s     | 2              | 2 x 4 = 8  |
| large    | normal   | 600s     | 4              | 4 x 4 = 16 |

### Queuing 

First, Alice will submit a burst of short running jobs that exceeds
the number of available GPUs in the cluster.  The excess jobs will
suspended by Kueue and admitted in turn as resources become available.

```sh
kubectl create -f ./setup.KubeConEU25/sample-jobs/short.yaml -n blue --as alice
kubectl create -f ./setup.KubeConEU25/sample-jobs/short.yaml -n blue --as alice
kubectl create -f ./setup.KubeConEU25/sample-jobs/short.yaml -n blue --as alice
kubectl create -f ./setup.KubeConEU25/sample-jobs/short.yaml -n blue --as alice
kubectl create -f ./setup.KubeConEU25/sample-jobs/short.yaml -n blue --as alice
kubectl create -f ./setup.KubeConEU25/sample-jobs/short.yaml -n blue --as alice
kubectl create -f ./setup.KubeConEU25/sample-jobs/short.yaml -n blue --as alice
```

Since no one else is using the cluster, Alice is able to utilize
both her blue team's quota of 8 GPUs and to borrow all 8 GPUs from the red team's quota 
and the 8 GPUs allocated to the slack cluster queue.  During this part of the demo,
we will start with 3 admitted jobs and 5 pending jobs on the blue cluster queue. Over
the next two minutes, the queue will drain as the short running jobs complete and the
next pending job is admitted.

### Borrowing and Preemption

Alice will now submit 4 normal jobs.  Again, with borrowing, three of these jobs
will be able to run immediately and the 4th job will be queued.

```sh
kubectl create -f ./setup.KubeConEU25/sample-jobs/normal.yaml -n blue --as alice
kubectl create -f ./setup.KubeConEU25/sample-jobs/normal.yaml -n blue --as alice
kubectl create -f ./setup.KubeConEU25/sample-jobs/normal.yaml -n blue --as alice
kubectl create -f ./setup.KubeConEU25/sample-jobs/normal.yaml -n blue --as alice
```

Alice can use priorities to ensure her important jobs run quickly.

```sh
kubectl create -f ./setup.KubeConEU25/sample-jobs/important.yaml -n blue --as alice
```

One of Alice's normal jobs is automatically suspended and put back on the queue of 
waiting jobs to make its resource available for her high priority job.

Finally Bob on the red team arrives at work and submits two jobs.

```sh
kubectl create -f ./setup.KubeConEU25/sample-jobs/normal.yaml -n red --as bob
kubectl create -f ./setup.KubeConEU25/sample-jobs/normal.yaml -n red --as bob
```

Kueue ensures that Bob has immediate access to his team's allocated quota
by evicting borrowing jobs. One of Alice's running
jobs is quickly suspended and returned to her team's queue of pending jobs.

### Fault Tolerance

In this scenario, we will start fresh with an empty cluster.  Alice will submit
a single large job:

```sh
kubectl create -f ./setup.KubeConEU25/sample-jobs/large.yaml -n blue --as alice
```

After the job is running, we will simulate Autopilot detecting a serious GPU failure
on by labeling a Node:

```sh
 kubectl label node <node-name> autopilot.ibm.com/gpuhealth=EVICT --overwrite 
```

MLBatch will automatically trigger a reset of all running jobs with Pods on 
the impacted node. This reset first does a clean removal of all of the job's
Pods and then creates fresh versions of them.  Since MLBatch automatically injects 
the Kubernetes affinities shown below into all Pods it creates for user workloads,
the Kubernetes scheduler will avoid scheduling the new Pods on the impacted Node.
```yaml
    affinity:
      nodeAffinity:
        requiredDuringSchedulingIgnoredDuringExecution:
          nodeSelectorTerms:
          - matchExpressions:
            - key: autopilot.ibm.com/gpuhealth
              operator: NotIn
              values:
              - ERR
              - TESTING
              - EVICT
```

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
first invocation so that subsequent instantiations of the model will reuse the
cached model weights.
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
Pod with two containers. The `vllm` container runs the inference runtime using
an upstream `vllm-openai` image. The `load-generator` container submits a random
series of requests to the inference runtime and reports a number of metrics such
as _Time to First Token_ (TTFT) and _Time per Output Token_ (TPOT).
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
            labels:
              app: batch-inference
          spec:
            restartPolicy: Never
            containers:
              - name: vllm
                image: quay.io/tardieu/vllm-openai:v0.7.3 # vllm/vllm-openai:v0.7.3
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
                  # wait for vllm, submit batch of requests, send halt signal
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

Stream the logs of the `vllm` container with:
```sh
kubectl logs --as alice -n blue -l app=batch-inference -c vllm -f
```
Stream the logs of the `load-generator` container with:
```sh
kubectl logs --as alice -n blue -l app=batch-inference -c load-generator -f
```
Delete the complete workload with:
```sh
kubectl delete --as alice -n blue appwrapper batch-inference
```

</details>

### Pre-Training with PyTorch

In this example, `alice` uses the [Kubeflow Trainer](https://github.com/kubeflow/trainer)
to run a job that uses [PyTorch](https://pytorch.org) to train a machine learning model.

<details>

This example was constructed by converting a [PyTorch tutorial on FSDP](https://pytorch.org/tutorials/intermediate/FSDP_tutorial.html)
into a KubeFlow Trainer [notebook](./sample-jobs/pytorch-training.ipynb) that we used to generate
the yaml for a `PyTorchJob`.  The YAML generated by running the notebook was then put inside an
`AppWrapper` using MLBatch's [awpack tool](../tools/appwrapper-packager/awpack.py) to produce the final YAML
that we will apply by executing the command below.

```sh
kubectl apply --as alice -n blue -f- << EOF
apiVersion: workload.codeflare.dev/v1beta2
kind: AppWrapper
metadata:
  name: pytorch-mnist-training
  labels:
    kueue.x-k8s.io/queue-name: default-queue
spec:
  components:
  - template:
      apiVersion: kubeflow.org/v1
      kind: PyTorchJob
      metadata:
        name: mnist-training
      spec:
        nprocPerNode: "2"
        pytorchReplicaSpecs:
          Master:
            replicas: 1
            template:
              metadata:
                annotations:
                  sidecar.istio.io/inject: "false"
              spec:
                containers:
                - args:
                  - |2-
                    program_path=$(mktemp -d)
                    read -r -d '' SCRIPT << EOM
                    def train_function(parameters):
                        import os
                        import time
                        import functools
                        import torch
                        import torch.nn as nn
                        import torch.nn.functional as F
                        import torch.optim as optim
                        from torchvision import datasets, transforms
                        from torch.optim.lr_scheduler import StepLR
                        import torch.distributed as dist
                        import torch.distributed as dist
                        import torch.multiprocessing as mp
                        from torch.nn.parallel import DistributedDataParallel as DDP
                        from torch.utils.data.distributed import DistributedSampler
                        from torch.distributed.fsdp import FullyShardedDataParallel as FSDP
                        from torch.distributed.fsdp.fully_sharded_data_parallel import (
                            CPUOffload,
                            BackwardPrefetch,
                        )
                        from torch.distributed.fsdp.wrap import (
                            size_based_auto_wrap_policy,
                            enable_wrap,
                            wrap,
                        )
                        class Net(nn.Module):
                            def __init__(self):
                                super(Net, self).__init__()
                                self.conv1 = nn.Conv2d(1, 32, 3, 1)
                                self.conv2 = nn.Conv2d(32, 64, 3, 1)
                                self.dropout1 = nn.Dropout(0.25)
                                self.dropout2 = nn.Dropout(0.5)
                                self.fc1 = nn.Linear(9216, 128)
                                self.fc2 = nn.Linear(128, 10)
                            def forward(self, x):
                                x = self.conv1(x)
                                x = F.relu(x)
                                x = self.conv2(x)
                                x = F.relu(x)
                                x = F.max_pool2d(x, 2)
                                x = self.dropout1(x)
                                x = torch.flatten(x, 1)
                                x = self.fc1(x)
                                x = F.relu(x)
                                x = self.dropout2(x)
                                x = self.fc2(x)
                                output = F.log_softmax(x, dim=1)
                                return output
                        def train(args, model, rank, world_size, train_loader, optimizer, epoch, sampler=None):
                            model.train()
                            ddp_loss = torch.zeros(2).to(rank)
                            if sampler:
                                sampler.set_epoch(epoch)
                            for batch_idx, (data, target) in enumerate(train_loader):
                                data, target = data.to(rank), target.to(rank)
                                optimizer.zero_grad()
                                output = model(data)
                                loss = F.nll_loss(output, target, reduction='sum')
                                loss.backward()
                                optimizer.step()
                                ddp_loss[0] += loss.item()
                                ddp_loss[1] += len(data)
                            dist.all_reduce(ddp_loss, op=dist.ReduceOp.SUM)
                            if rank == 0:
                                print('Train Epoch: {} \tLoss: {:.6f}'.format(epoch, ddp_loss[0] / ddp_loss[1]))
                        def test(model, rank, world_size, test_loader):
                            model.eval()
                            correct = 0
                            ddp_loss = torch.zeros(3).to(rank)
                            with torch.no_grad():
                                for data, target in test_loader:
                                    data, target = data.to(rank), target.to(rank)
                                    output = model(data)
                                    ddp_loss[0] += F.nll_loss(output, target, reduction='sum').item()  # sum up batch loss
                                    pred = output.argmax(dim=1, keepdim=True)  # get the index of the max log-probability
                                    ddp_loss[1] += pred.eq(target.view_as(pred)).sum().item()
                                    ddp_loss[2] += len(data)
                            dist.all_reduce(ddp_loss, op=dist.ReduceOp.SUM)
                            if rank == 0:
                                test_loss = ddp_loss[0] / ddp_loss[2]
                                print('Test set: Average loss: {:.4f}, Accuracy: {}/{} ({:.2f}%)\n'.format(
                                    test_loss, int(ddp_loss[1]), int(ddp_loss[2]),
                                    100. * ddp_loss[1] / ddp_loss[2]))
                        # [1] Setup PyTorch distributed and get the distributed parameters.
                        torch.manual_seed(parameters["seed"])
                        dist.init_process_group("nccl")
                        local_rank = int(os.environ["LOCAL_RANK"])
                        rank = dist.get_rank()
                        world_size = dist.get_world_size()
                        # Local rank identifies the GPU number inside the pod.
                        torch.cuda.set_device(local_rank)
                        print(
                            f"FSDP Training for WORLD_SIZE: {world_size}, RANK: {rank}, LOCAL_RANK: {local_rank}"
                        )
                        transform=transforms.Compose([
                            transforms.ToTensor(),
                            transforms.Normalize((0.1307,), (0.3081,))
                        ])
                        dataset1 = datasets.MNIST('/tmp/data', train=True, download=True,
                                            transform=transform)
                        dataset2 = datasets.MNIST('/tmp/data', train=False,
                                            transform=transform)
                        sampler1 = DistributedSampler(dataset1, rank=rank, num_replicas=world_size, shuffle=True)
                        sampler2 = DistributedSampler(dataset2, rank=rank, num_replicas=world_size)
                        train_kwargs = {'batch_size': parameters["batch-size"], 'sampler': sampler1}
                        test_kwargs = {'batch_size': parameters["test-batch-size"], 'sampler': sampler2}
                        cuda_kwargs = {'num_workers': 2,
                                        'pin_memory': True,
                                        'shuffle': False}
                        train_kwargs.update(cuda_kwargs)
                        test_kwargs.update(cuda_kwargs)
                        train_loader = torch.utils.data.DataLoader(dataset1,**train_kwargs)
                        test_loader = torch.utils.data.DataLoader(dataset2, **test_kwargs)
                        my_auto_wrap_policy = functools.partial(
                            size_based_auto_wrap_policy, min_num_params=100
                        )
                        init_start_event = torch.cuda.Event(enable_timing=True)
                        init_end_event = torch.cuda.Event(enable_timing=True)
                        model = Net().to(local_rank)
                        model = FSDP(model)
                        optimizer = optim.Adadelta(model.parameters(), lr=parameters["lr"])
                        scheduler = StepLR(optimizer, step_size=1, gamma=parameters["gamma"])
                        init_start_event.record()
                        for epoch in range(1, parameters["epochs"] + 1):
                            train(parameters, model, local_rank, world_size, train_loader, optimizer, epoch, sampler=sampler1)
                            test(model, local_rank, world_size, test_loader)
                            scheduler.step()
                        init_end_event.record()
                        if rank == 0:
                            init_end_event.synchronize()
                            print(f"CUDA event elapsed time: {init_start_event.elapsed_time(init_end_event) / 1000}sec")
                            print(f"{model}")
                        if parameters["save-model"]:
                            # use a barrier to make sure training is done on all ranks
                            dist.barrier()
                            states = model.state_dict()
                            if rank == 0:
                                torch.save(states, "mnist_cnn.pt")
                    train_function({'batch-size': 64, 'test-batch-size': 1000, 'epochs': 10, 'lr': 1.0, 'gamma': 0.7, 'seed': 1, 'save-model': False})
                    EOM
                    printf "%s" "$SCRIPT" > "$program_path/ephemeral_script.py"
                    torchrun "$program_path/ephemeral_script.py"
                  command:
                  - bash
                  - -c
                  image: docker.io/pytorch/pytorch:2.1.2-cuda11.8-cudnn8-runtime
                  name: pytorch
                  resources:
                    limits:
                      nvidia.com/gpu: "2"
                    requests:
                      nvidia.com/gpu: "2"
          Worker:
            replicas: 1
            template:
              metadata:
                annotations:
                  sidecar.istio.io/inject: "false"
              spec:
                containers:
                - args:
                  - |2-
                    program_path=$(mktemp -d)
                    read -r -d '' SCRIPT << EOM
                    def train_function(parameters):
                        import os
                        import time
                        import functools
                        import torch
                        import torch.nn as nn
                        import torch.nn.functional as F
                        import torch.optim as optim
                        from torchvision import datasets, transforms
                        from torch.optim.lr_scheduler import StepLR
                        import torch.distributed as dist
                        import torch.distributed as dist
                        import torch.multiprocessing as mp
                        from torch.nn.parallel import DistributedDataParallel as DDP
                        from torch.utils.data.distributed import DistributedSampler
                        from torch.distributed.fsdp import FullyShardedDataParallel as FSDP
                        from torch.distributed.fsdp.fully_sharded_data_parallel import (
                            CPUOffload,
                            BackwardPrefetch,
                        )
                        from torch.distributed.fsdp.wrap import (
                            size_based_auto_wrap_policy,
                            enable_wrap,
                            wrap,
                        )
                        class Net(nn.Module):
                            def __init__(self):
                                super(Net, self).__init__()
                                self.conv1 = nn.Conv2d(1, 32, 3, 1)
                                self.conv2 = nn.Conv2d(32, 64, 3, 1)
                                self.dropout1 = nn.Dropout(0.25)
                                self.dropout2 = nn.Dropout(0.5)
                                self.fc1 = nn.Linear(9216, 128)
                                self.fc2 = nn.Linear(128, 10)
                            def forward(self, x):
                                x = self.conv1(x)
                                x = F.relu(x)
                                x = self.conv2(x)
                                x = F.relu(x)
                                x = F.max_pool2d(x, 2)
                                x = self.dropout1(x)
                                x = torch.flatten(x, 1)
                                x = self.fc1(x)
                                x = F.relu(x)
                                x = self.dropout2(x)
                                x = self.fc2(x)
                                output = F.log_softmax(x, dim=1)
                                return output
                        def train(args, model, rank, world_size, train_loader, optimizer, epoch, sampler=None):
                            model.train()
                            ddp_loss = torch.zeros(2).to(rank)
                            if sampler:
                                sampler.set_epoch(epoch)
                            for batch_idx, (data, target) in enumerate(train_loader):
                                data, target = data.to(rank), target.to(rank)
                                optimizer.zero_grad()
                                output = model(data)
                                loss = F.nll_loss(output, target, reduction='sum')
                                loss.backward()
                                optimizer.step()
                                ddp_loss[0] += loss.item()
                                ddp_loss[1] += len(data)
                            dist.all_reduce(ddp_loss, op=dist.ReduceOp.SUM)
                            if rank == 0:
                                print('Train Epoch: {} \tLoss: {:.6f}'.format(epoch, ddp_loss[0] / ddp_loss[1]))
                        def test(model, rank, world_size, test_loader):
                            model.eval()
                            correct = 0
                            ddp_loss = torch.zeros(3).to(rank)
                            with torch.no_grad():
                                for data, target in test_loader:
                                    data, target = data.to(rank), target.to(rank)
                                    output = model(data)
                                    ddp_loss[0] += F.nll_loss(output, target, reduction='sum').item()  # sum up batch loss
                                    pred = output.argmax(dim=1, keepdim=True)  # get the index of the max log-probability
                                    ddp_loss[1] += pred.eq(target.view_as(pred)).sum().item()
                                    ddp_loss[2] += len(data)
                            dist.all_reduce(ddp_loss, op=dist.ReduceOp.SUM)
                            if rank == 0:
                                test_loss = ddp_loss[0] / ddp_loss[2]
                                print('Test set: Average loss: {:.4f}, Accuracy: {}/{} ({:.2f}%)\n'.format(
                                    test_loss, int(ddp_loss[1]), int(ddp_loss[2]),
                                    100. * ddp_loss[1] / ddp_loss[2]))
                        # [1] Setup PyTorch distributed and get the distributed parameters.
                        torch.manual_seed(parameters["seed"])
                        dist.init_process_group("nccl")
                        local_rank = int(os.environ["LOCAL_RANK"])
                        rank = dist.get_rank()
                        world_size = dist.get_world_size()
                        # Local rank identifies the GPU number inside the pod.
                        torch.cuda.set_device(local_rank)
                        print(
                            f"FSDP Training for WORLD_SIZE: {world_size}, RANK: {rank}, LOCAL_RANK: {local_rank}"
                        )
                        transform=transforms.Compose([
                            transforms.ToTensor(),
                            transforms.Normalize((0.1307,), (0.3081,))
                        ])
                        dataset1 = datasets.MNIST('/tmp/data', train=True, download=True,
                                            transform=transform)
                        dataset2 = datasets.MNIST('/tmp/data', train=False,
                                            transform=transform)
                        sampler1 = DistributedSampler(dataset1, rank=rank, num_replicas=world_size, shuffle=True)
                        sampler2 = DistributedSampler(dataset2, rank=rank, num_replicas=world_size)
                        train_kwargs = {'batch_size': parameters["batch-size"], 'sampler': sampler1}
                        test_kwargs = {'batch_size': parameters["test-batch-size"], 'sampler': sampler2}
                        cuda_kwargs = {'num_workers': 2,
                                        'pin_memory': True,
                                        'shuffle': False}
                        train_kwargs.update(cuda_kwargs)
                        test_kwargs.update(cuda_kwargs)
                        train_loader = torch.utils.data.DataLoader(dataset1,**train_kwargs)
                        test_loader = torch.utils.data.DataLoader(dataset2, **test_kwargs)
                        my_auto_wrap_policy = functools.partial(
                            size_based_auto_wrap_policy, min_num_params=100
                        )
                        init_start_event = torch.cuda.Event(enable_timing=True)
                        init_end_event = torch.cuda.Event(enable_timing=True)
                        model = Net().to(local_rank)
                        model = FSDP(model)
                        optimizer = optim.Adadelta(model.parameters(), lr=parameters["lr"])
                        scheduler = StepLR(optimizer, step_size=1, gamma=parameters["gamma"])
                        init_start_event.record()
                        for epoch in range(1, parameters["epochs"] + 1):
                            train(parameters, model, local_rank, world_size, train_loader, optimizer, epoch, sampler=sampler1)
                            test(model, local_rank, world_size, test_loader)
                            scheduler.step()
                        init_end_event.record()
                        if rank == 0:
                            init_end_event.synchronize()
                            print(f"CUDA event elapsed time: {init_start_event.elapsed_time(init_end_event) / 1000}sec")
                            print(f"{model}")
                        if parameters["save-model"]:
                            # use a barrier to make sure training is done on all ranks
                            dist.barrier()
                            states = model.state_dict()
                            if rank == 0:
                                torch.save(states, "mnist_cnn.pt")
                    train_function({'batch-size': 64, 'test-batch-size': 1000, 'epochs': 10, 'lr': 1.0, 'gamma': 0.7, 'seed': 1, 'save-model': False})
                    EOM
                    printf "%s" "$SCRIPT" > "$program_path/ephemeral_script.py"
                    torchrun "$program_path/ephemeral_script.py"
                  command:
                  - bash
                  - -c
                  image: docker.io/pytorch/pytorch:2.1.2-cuda11.8-cudnn8-runtime
                  name: pytorch
                  resources:
                    limits:
                      nvidia.com/gpu: "2"
                    requests:
                      nvidia.com/gpu: "2"
        runPolicy:
          suspend: false
EOF
```

This will create 2 Pods, each requesting 2 GPUs.  On our cluster, it will take about 30 seconds
to execute this training workload. We can check on the status of the PyTorchJob by using the command:

```sh
kubectl get pytorchjob -n blue
```

After the jobs completes, we can get the log of the worker Pod with

```sh 
kubectl logs mnist-training-worker-0 -n blue
```

At the beginning of the log we can see messages from each Python process
with its rank information:
```sh
...
FSDP Training for WORLD_SIZE: 4, RANK: 3, LOCAL_RANK: 1
...
FSDP Training for WORLD_SIZE: 4, RANK: 2, LOCAL_RANK: 0
```
And at the end of the log, we can see the messages from the `LOCAL_RANK` `0`
process summarizing each epoch:
```sh
...

Train Epoch: 1 	Loss: 0.247396
Test set: Average loss: 0.0498, Accuracy: 9824/10000 (98.24%)

Train Epoch: 2 	Loss: 0.070375
Test set: Average loss: 0.0355, Accuracy: 9874/10000 (98.74%)

Train Epoch: 3 	Loss: 0.047944
Test set: Average loss: 0.0291, Accuracy: 9900/10000 (99.00%)

Train Epoch: 4 	Loss: 0.038316
Test set: Average loss: 0.0282, Accuracy: 9906/10000 (99.06%)

Train Epoch: 5 	Loss: 0.032751
Test set: Average loss: 0.0276, Accuracy: 9906/10000 (99.06%)

Train Epoch: 6 	Loss: 0.028068
Test set: Average loss: 0.0275, Accuracy: 9905/10000 (99.05%)

Train Epoch: 7 	Loss: 0.028161
Test set: Average loss: 0.0254, Accuracy: 9916/10000 (99.16%)

Train Epoch: 8 	Loss: 0.025051
Test set: Average loss: 0.0260, Accuracy: 9911/10000 (99.11%)

Train Epoch: 9 	Loss: 0.023851
Test set: Average loss: 0.0264, Accuracy: 9916/10000 (99.16%)

Train Epoch: 10 	Loss: 0.023334
Test set: Average loss: 0.0255, Accuracy: 9916/10000 (99.16%)
```

When we are all done, we can delete the completed `AppWrapper` with:

```sh
 kubectl delete appwrapper pytorch-mnist-training -n blue
```
</details>

### Fine-Tuning with Ray

In this example, `alice` uses [KubeRay](https://github.com/ray-project/kuberay)
to run a job that uses [Ray](https://github.com/ray-project/ray) to fine tune a
machine learning model.

This workload is an adaptation from [this blog post by Red Hat](https://developers.redhat.com/articles/2024/09/30/fine-tune-llama-openshift-ai), in turn adapted from [an example on Ray documentation](https://github.com/ray-project/ray/tree/master/doc/source/templates/04_finetuning_llms_with_deepspeed).
The example is about fine tuning Llama 3.1 with Ray, with DeepSpeed and LoRA.

<details>

Let's set up the environment by installing Ray and cloning the repository

```bash
uv venv myenv --python 3.12 --seed && source myenv/bin/activate && uv pip install ray datasets
```

We are going to impersonate Alice in this example.

First, we create the PVC where we can download the model and save the checkpoints from the fine tuning job. We are calling this PVC `finetuning-pvc` and we need to add this to the Ray cluster YAML. If another name is used, please update the `claimName` entry in the Ray cluster definition.

```bash
kubectl apply --as alice -n blue -f- << EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: finetuning-pvc
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 100Gi
  storageClassName: nfs-client-pokprod
EOF
```

Now, let's create an AppWrapper version of the Ray cluster. Notice that:

- We are using the container image `quay.io/rhoai/ray:2.35.0-py311-cu121-torch24-fa26` from Red Hat, but you can use the images from DockerHub if preferred
- We are setting the number of worker replicas to `7`. Since we want to run on one GPU node, we are assigning one to the Ray Head pod, and one each to the 7 worker pods.

```bash
cd tools/appwrapper-packager/
cat << EOF > ray.yaml
apiVersion: ray.io/v1
kind: RayCluster
metadata:
  name: ray
spec:
  headGroupSpec:
    enableIngress: false
    rayStartParams:
      block: 'true'
      dashboard-host: 0.0.0.0
      num-gpus: '1'
      resources: '"{}"'
    serviceType: ClusterIP
    template:
      metadata: {}
      spec:
        containers:
          - env:
              - name: MY_POD_IP
                valueFrom:
                  fieldRef:
                    fieldPath: status.podIP
              - name: RAY_USE_TLS
                value: '0'
            image: 'quay.io/rhoai/ray:2.35.0-py311-cu121-torch24-fa26'
            imagePullPolicy: Always
            lifecycle:
              preStop:
                exec:
                  command:
                    - /bin/sh
                    - '-c'
                    - ray stop
            name: ray-head
            ports:
              - containerPort: 6379
                name: gcs
                protocol: TCP
              - containerPort: 8265
                name: dashboard
                protocol: TCP
              - containerPort: 10001
                name: client
                protocol: TCP
            resources:
              limits:
                cpu: '16'
                memory: 256G
                nvidia.com/gpu: '1'
              requests:
                cpu: '16'
                memory: 128G
                nvidia.com/gpu: '1'
            volumeMounts:
              - mountPath: /model
                name: model
        volumes:
          - name: model
            persistentVolumeClaim:
              claimName: finetuning-pvc
  rayVersion: 2.35.0
  workerGroupSpecs:
    - groupName: small-group-ray
      rayStartParams:
        block: 'true'
        num-gpus: '1'
        resources: '"{}"'
      replicas: 7
      scaleStrategy: {}
      template:
        metadata: {}
        spec:
          containers:
            - env:
                - name: MY_POD_IP
                  valueFrom:
                    fieldRef:
                      fieldPath: status.podIP
                - name: RAY_USE_TLS
                  value: '0'
              image: 'quay.io/rhoai/ray:2.35.0-py311-cu121-torch24-fa26'
              imagePullPolicy: Always
              lifecycle:
                preStop:
                  exec:
                    command:
                      - /bin/sh
                      - '-c'
                      - ray stop
              name: machine-learning
              resources:
                limits:
                  cpu: '16'
                  memory: 256G
                  nvidia.com/gpu: '1'
                requests:
                  cpu: '16'
                  memory: 128G
                  nvidia.com/gpu: '1'
              volumeMounts:
                - mountPath: /model
                  name: model
          volumes:
            - name: model
              persistentVolumeClaim:
                claimName: finetuning-pvc             
EOF
```

Now let's use the tool to create the appwrapper:

```bash
./awpack.py -o ray-aw.yaml -n ray-appwrapper -i ray.yaml
```

Now we can submit the job while impersonating Alice

```bash
kubectl create -f ray-aw.yaml -n blue --as alice
```

Now that the Ray cluster is set up, first we need to expose the `ray-head` service, as that is the entrypoint for all job submissions. In another terminal, type:

```bash
kubectl port-forward svc/ray-head-svc 8265:8265 -n blue --as alice
```

Now we can download the git repository with the fine tuning workload.

```bash
git clone https://github.com/opendatahub-io/distributed-workloads
cd distributed-workloads/examples/ray-finetune-llm-deepspeed
```

We also create a Python program that launches the job in the Ray cluster using the Ray API.
Notice that:

- We set the `--num-devices=8` as it is the total number of accelerators being used by head and workers
- we set the `HF_HOME` to the shared PVC, so the model will be downloaded as a single instance and shared among all executors
- we set `epochs` to just one for a shorter run
- we use localhost as entry point for submitting Ray jobs as we exposed the service earlier.

```bash
cat << EOF > finetuning.py
import create_dataset
create_dataset.gsm8k_qa_no_tokens_template()

from ray.job_submission import JobSubmissionClient

client = JobSubmissionClient("http://127.0.0.1:8265")

kick_off_pytorch_benchmark = (
    "git clone https://github.com/opendatahub-io/distributed-workloads || true;"
    # Run the benchmark.
    "python ray_finetune_llm_deepspeed.py"
    " --model-name=meta-llama/Meta-Llama-3.1-8B --lora --num-devices=8 --num-epochs=1 --ds-config=./deepspeed_configs/zero_3_offload_optim_param.json  --storage-path=/model/ --batch-size-per-device=32 --eval-batch-size-per-device=32"
)


submission_id = client.submit_job(
    entrypoint=kick_off_pytorch_benchmark,
    runtime_env={
        "env_vars": {
            'HF_HOME': "/model/ray_finetune_llm_deepspeed/cache/",
        },
        'pip': 'requirements.txt',
        'working_dir': './',
        "excludes": ["/docs/", "*.ipynb", "*.md"]
    },
)

print("Use the following command to follow this Job's logs:")
print(f"ray job logs '{submission_id}' --address http://127.0.0.1:8265 --follow")
EOF
python finetuning.py
```
The expected output is like the following:
```bash
2025-03-24 16:37:53,029	INFO dashboard_sdk.py:338 -- Uploading package gcs://_ray_pkg_21ddaa8b13d30deb.zip.
2025-03-24 16:37:53,030	INFO packaging.py:575 -- Creating a file package for local module './'.
Use the following command to follow this Job's logs:
ray job logs 'raysubmit_C6hVCvdhpmapgQB8' --address http://127.0.0.1:8265 --follow
```

We can now either follow the logs on the terminal with `ray job logs` command, or open the Ray dashboard and follow from there. To access the Ray dashboard from localhost, as we exposed the service earlier.

Once the job is completed, the checkpoint with the fine tuned model is saved in the folder 
```
/model/meta-llama/Meta-Llama-3.1-8B/TorchTrainer_<timestamp>/TorchTrainer_<id_timestamp>/checkpoint_<ID>
```
</details>
