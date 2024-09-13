# MLBatch for CodeFlare Users

MLBatch is an evolution of the [CodeFlare](https://github.com/project-codeflare)
stack for managing AI/ML workloads on Kubernetes and its workload dispatcher
[MCAD](https://github.com/project-codeflare/multi-cluster-app-dispatcher).

Like MCAD, MLBatch is designed to queue workloads and admit them for execution over time,
accounting for quotas, priorities, and precedence. MLBatch relies on
[AppWrappers](https://github.com/project-codeflare/appwrapper) to bundle
together all the components of a workloads such as pods, PyTorch jobs, Ray jobs,
config maps, secrets, etc. AppWrappers in MLBatch offer improved mechanisms to
automatically detect and retry failed workloads. MLBatch includes a
backward-compatible [pytorch-generator](tools/pytorchjob-generator/) Helm
template to facilitate the specification of PyTorch jobs.

In this document, we review the key innovations introduced by MLBatch and
differences with the earlier setup built around MCAD.

## Kueue

MLBatch replaces MCAD with [Kueue](https://kueue.sigs.k8s.io) to queue and
admit jobs. Kueue introduces a new quota management system based on [cluster
queues](https://kueue.sigs.k8s.io/docs/concepts/cluster_queue/). This quota
system provides more flexibility to allocate compute resources (CPU, memory, and
GPU quotas) than [resource
quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/) in core
Kubernetes. This system allows the borrowing of unused quota between
cluster queues (see [Priorities and Preemption below](#priorities-and-preemption)).
Borrowing enables high overall cluster resource utilization while
still ensuring that every team always has the ability to run jobs up to their
allocated quotas. Kueue also enables teams to use
priorities to order jobs within their own cluster queue without those
priorities impacting the scheduling of jobs by other cluster queues.

Unlike MCAD, Kueue only considers quotas when admitting workloads. As a result,
MLBatch must ensure that all resource-consuming workloads in user namespaces are managed
by Kueue.  This is accomplished by strictly [limiting the Kinds](#allowed-kinds)
of non-AppWrapper resources users are permitted to create.

For various reasons, workloads are not directly submitted to cluster queues but
rather to namespaced [local
queues](https://kueue.sigs.k8s.io/docs/concepts/local_queue/) that feed into the
cluster queues. By convention in MLBatch, each team is assigned a namespace and
a cluster queue dedicated to the team. For example, the _platform_ team is
assigned to namespace `platform` and its associated cluster queue named
`platform-cluster-queue`. The local queue name in each namespace in MLBatch is always `default-queue`.
Hence, the `default-queue` in namespace `platform` feeds into the
`platform-cluster-queue`. In short, all workloads must be submitted to the local
queue named `default-queue` but to review quota allocation and usage, one has to
query the cluster queues.

MLBatch offers a simple [cluster-checker](tools/cluster-checker/) tool to get a
bird’s-eye view of quotas on a cluster from a GPU perspective:
```sh
node checker.js
```
```
CLUSTER QUEUE            GPU QUOTA   GPU USAGE   ADMITTED WORKLOADS   PENDING WORKLOADS
code-cluster-queue               8          16                    1                   0
platform-cluster-queue           8           4                    4                   0

Total GPU count in cluster:        24
Unschedulable GPU count:         -  0
Schedulable GPU count:           = 24

Nominal GPU quota:                 16
Slack GPU quota:                 +  8
Total GPU quota:                 = 24

GPU usage by admitted workloads:   20
Borrowed GPU count:                 8
```
The tool lists the cluster queues defined on the cluster showing the GPU
quota for each one as well as the number of GPUs in use by admitted workloads.
The GPU usage may exceed the GPU quota for the cluster queue if this cluster queue
is borrowing idle capacity.

The tool also reports the total GPU capacity distinguishing healthy (i.e.,
schedulable, available for use) and unhealthy (i.e., unschedulable, unavailable)
GPUs. The nominal GPU quota represents the cumulative GPU quota across all the
teams. MLBatch recommends that cluster admins keep the nominal quota below the
cluster capacity to avoid oversubscribing the GPUs. Typically, a small number of
GPUs is not allocated to any team but retained as a slack quota that any team
may borrow from. MLBatch automatically adjusts the slack quota to ensure the
schedulable GPU count and nominal quota remain equal, unless of course this
slack becomes virtually negative, in which case a cluster admin should decide
how to reduce the nominal quota.

For more details about the cluster queues run:
```sh
kubectl describe clusterqueues
```

## AppWrappers

MLBatch recommends submitting every workload as an
[AppWrapper](https://github.com/project-codeflare/appwrapper). AppWrappers offer
a number of checks, guarantees, and benefits over submitting unwrapped
[PyTorchJobs](https://www.kubeflow.org/docs/components/training/user-guides/pytorch/)
for example. In particular, the AppWrapper controller automatically injects:
- labels holding the name and id of the user submitting the AppWrapper,
- the `queueName` label required to queue the workload in the `default-queue`,
  and
- the `schedulerName` specification required to enable gang scheduling and
  packing on the GPU dimension to mitigate node fragmentation.

Moreover, the AppWrapper controller consistently handles cleanup and retries
across all types of workloads:
- The resources, especially the GPUs, utilized by a failed workload are returned
  to the cluster in a timely manner, i.e., within minutes by default, with a
  configurable grace period to permit post-mortem debugging. Cluster admins can
  enforce an upper bound on this grace period to bound resource wastage.
- The Kubernetes objects associated with a completed workload, in particular the
  pods and their logs, are eventually disposed of, by default after a week.
- Failed workloads are automatically retried up to a configurable number of
  attempts.

The AppWrapper specification has been greatly simplified for MLBatch. In most
cases, an AppWrapper yaml adds a simple prefix to a workload yaml, for instance
for a pod:
```yaml
# appwrapper prefix
apiVersion: workload.codeflare.dev/v1beta2
kind: AppWrapper
metadata:
  name: wrapped-pod
spec:
  components:
  - template:
      # indented pod specification
      apiVersion: v1
      kind: Pod
      metadata:
        name: sample-pod
      spec:
        restartPolicy: Never
        containers:
        - name: busybox
          image: quay.io/project-codeflare/busybox:1.36
          command: ["sh", "-c", "sleep 5"]
          resources:
            requests:
              cpu: 1
```
To submit this workload to the cluster, save this yaml to `wrapped-pod.yaml` and
run:
```sh
kubectl apply -f wrapped-pod.yaml
```

MLBatch includes an [appwrapper-packager](tools/appwrapper-packager/) tool to
automate the addition this prefix as well as the indentation of the workload
specification. In addition, MLBatch includes a new implementation of the
[pytorch-generator](tools/pytorchjob-generator/) tool to facilitate the
configuration of PyTorch jobs including the addition of the AppWrapper prefix.

As a result of the AppWrapper simplification for MLBatch, AppWrappers which are
now in version `v1beta2` are not backward compatible with MCAD's `v1beta1`
AppWrappers. The companion pytorch-generator tool for MCAD is not compatible
with MLBatch. However, the pytorch-generator tool included in MLBatch is
backward compatible with the input format of the legacy tool. In other words,
simply rerun `helm template` on the input `value.yaml` files to generate proper
`v1beta2` AppWrappers. Please note that existing fault-tolerance-related
settings from these input files will be ignored and default will be used
instead. Please refer to the tool [documentation](tools/pytorchjob-generator/)
for how to override settings such as max retry counts.

The list of all AppWrappers in a namespace is obtained by running:
```sh
kubectl get appwrappers
```
```
NAME          STATUS      QUOTA RESERVED   RESOURCES DEPLOYED   UNHEALTHY
wrapped-pod   Succeeded   False            True                 False
```
The status of an AppWrapper is one of:
- Suspended: the AppWrapper is queued,
- Resuming: the AppWrapper is transitioning to Running,
- Running: the AppWrapper is running,
- Succeeded: the execution completed successfully,
- Failed: the execution failed and will not be retried,
- Resetting: a failure has been detected during the current execution and the
  AppWrapper is preparing to retry,
- Suspending: the AppWrapper has been evicted by Kueue and is transitioning back
  to Suspended.

```mermaid
---
title: AppWrapper Lifecycle
---
stateDiagram-v2
    f : Failed
    sp : Suspended
    ad : Admitted
    s : Succeeded
    su: Suspending

    state ad {
      [*] --> rs
      rs --> rn
      rn --> rt 
      rt --> rs
 
      rs : Resuming
      rn : Running
      rt : Resetting
    }

    [*] --> sp
    sp --> ad
    rn --> s
    ad --> su
    su --> sp
    ad --> f
 
    classDef admitted fill:lightblue
    class rs admitted
    class rn admitted
    class rt admitted

    classDef failed fill:pink
    class f failed

    classDef succeeded fill:lightgreen
    class s succeeded
```
In this diagram, the outer loop consisting of the `Suspended`, `Admitted`, and
`Suspending` states is managed by Kueue, while the inner loop consisting of the
`Resuming`, `Running`, and `Resetting` states is managed by the AppWrapper
controller. In particular, the AppWrapper controller handles workload retries
without releasing and reacquiring Kueue quotas, hence without moving retried
workloads to the back of the cluster queue.

In addition, this AppWrapper table also reports:
- quota reserved: whether Kueue has reserved the quota requested by the
  AppWrapper,
- resource deployed: whether the resources wrapped by the AppWrapper, such as
the `sample-pod` in this example have been created on the cluster,
- unhealthy: whether a failure has been detected during the current execution of
  the AppWrapper.

For example, a `Running` AppWrapper has both quota reserved and resource
deployed. A `Succeeded` AppWrapper will no longer reserve quota but the wrapped
resources such as terminated pods will be preserved on the cluster for a period
of time as discussed above to permit log collection. A `Failed` AppWrapper will
transiently continue to reserve quota until the wrapped resources have been
undeployed, so as to avoid oversubscribing GPUs during the cleanup of failed
jobs.

More details about an AppWrapper condition may be obtained by describing the
AppWrapper:
```sh
kubectl describe appwrapper wrapped-pod
```
Kueue creates and maintains a companion `Workload` object for each workload it
manages. Further details about the AppWrapper condition such as Kueue's
rationale for evicting the workload may be obtained by accessing this companion
object:
```sh
kubectl get workloads
```
```
NAME                           QUEUE           RESERVED IN           ADMITTED   AGE
appwrapper-wrapped-pod-81d3e   default-queue   team1-cluster-queue   True       161m
```
```sh
kubectl describe workload appwrapper-wrapped-pod-81d3e
```
Workload objects are automatically deleted by Kueue when the workload itself,
i.e., the AppWrapper is deleted.

## Priorities and Preemption

MLBatch supports the `high-priority`, `default-priority`, and `low-priority`
priority classes.

If you are using the pytorch-generator tool, you can override the default
`default-priority` of a workload by setting the `priority` variable. If you
are generating your yaml by other means, simply add a `priorityClassName`
to the specification of the wrapped pod templates, for example:
```yaml
# appwrapper prefix
apiVersion: workload.codeflare.dev/v1beta2
kind: AppWrapper
metadata:
  name: wrapped-pod
spec:
  components:
  - template:
      # indented pod specification
      apiVersion: v1
      kind: Pod
      metadata:
        name: sample-pod
      spec:
        priorityClassName: high-priority # workload priority
        restartPolicy: Never
        containers:
        - name: busybox
          image: quay.io/project-codeflare/busybox:1.36
          command: ["sh", "-c", "sleep 5"]
          resources:
            requests:
              cpu: 1
```

Workloads of equal priority are considered for admission by their cluster queue in submission order.
Higher-priority workloads are considered for admission before lower-priority
workloads irrespective of their submission time. However, workloads that cannot be
admitted will not block the admission of newer and/or lower-priority workloads
(if they fit within the nominal quota of the cluster queue).

To reduce workload churn, Kueue forbids workloads to
simultaneously utilize both preemption and borrowing to acquire the
necessary quota to be admitted.  Therefore a workload that by itself
exceeds the nominal quota of its cluster queue will never trigger
preemption. Similarly, if the combined resources of (a) a pending
workload and (b) the sum of all already admitted workloads with equal
or higher priority to the pending workload exceeds the nominal quota
of their cluster queue, Kueue will not preempt already admitted lower
priority workloads of that cluster queue to admit the pending
workload.

When a workload is pending on a cluster queue and admitting that
workload would still leave the cluster queue at or below its nominal
quota, Kueue may preempt one or more currently admitted workloads of
other cluster queues to reclaim the necessary borrowed quota.  When such
preemption is necessary, the decision of which workload(s) to preempt
is based solely on considering the currently admitted workloads of
just those cluster queues that are exceeding their nominal
quota. Workloads admitted by cluster queues that are currently at or
below their nominal quota will not be preempted.

## Allowed Kinds

MLBatch allows users to directly create the following Kinds of compute
resources:
   + AppWrapper
   + PyTorchJob (allowed, but recommend to put inside an AppWrapper)
   + RayJob (allowed, but recommend to put inside an AppWrapper)
   + RayCluster (allowed, but recommend to put inside an AppWrapper)

MLBatch also allows users to directly create the following Kinds of
non-compute resources:
   + Service
   + Secret
   + ConfigMap
   + PersistentVolumeClaim
   + PodGroup (allowed, but recommend to put inside an AppWrapper)

MLBatch allows users to wrap an arbitrary number of one or more of the
following Kinds inside of an AppWrapper:
   + PyTorchJob
   + RayJob
   + RayCluster
   + Deployment
   + StatefulSet
   + Pod
   + Job
   + ServiceAccount
   + Service
   + Secret
   + ConfigMap
   + PersistentVolumeClaim
   + PodGroup
