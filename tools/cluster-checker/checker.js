'use strict'

const k8s = require('@kubernetes/client-node')

class Client {
  constructor () {
    const config = new k8s.KubeConfig()
    config.loadFromDefault()
    config.getCurrentCluster().skipTLSVerify = true
    this.core = config.makeApiClient(k8s.CoreV1Api)
    this.custom = config.makeApiClient(k8s.CustomObjectsApi)
  }

  async nodes () {
    const res = await this.core.listNode()
    return res.body.items
  }

  async namespaces () {
    const res = await this.core.listNamespace()
    return res.body.items
  }

  async pods (namespace) {
    const res = await this.core.listNamespacedPod(namespace)
    return res.body.items
  }

  async readConfigMap (name, namespace) {
    const res = await this.core.readNamespacedConfigMap(name, namespace)
    return res.body
  }

  async clusterQueues () {
    const res = await this.custom.listClusterCustomObject(
      'kueue.x-k8s.io',
      'v1beta1',
      'clusterqueues')
    return res.body.items
  }

  async localQueues (namespace) {
    const res = await this.custom.listNamespacedCustomObject(
      'kueue.x-k8s.io',
      'v1beta1',
      namespace,
      'localqueues')
    return res.body.items
  }

  async workloads (namespace) {
    const res = await this.custom.listNamespacedCustomObject(
      'kueue.x-k8s.io',
      'v1beta1',
      namespace,
      'workloads')
    return res.body.items
  }
}

// return the number of GPUs reserved by the pod
function reservation (pod) {
  if (pod.status?.phase === 'Succeeded' || pod.status?.phase === 'Failed') {
    return 0 // pod has already completed
  }
  let scheduled = false
  for (const condition of pod.status?.conditions ?? []) {
    if (condition.type === 'PodScheduled') {
      if (condition.status === 'True') {
        scheduled = true
      }
      break // PodScheduled condition may only appear once
    }
  }
  if (!scheduled) {
    return 0 // pod has not been scheduled yet
  }
  let gpus = 0
  // compute sum of regular containers
  for (const container of pod.spec.containers) {
    gpus += parseInt(container.resources?.limits?.['nvidia.com/gpu'] ?? "0")
  }
  // compute max with init containers
  for (const container of pod.spec.initContainers ?? []) {
    gpus = Math.max(gpus, parseInt(container.resources?.limits?.['nvidia.com/gpu'] ?? "0"))
  }
  return gpus
}

// check workloads in user namespace and report total GPU usage for namespace
async function checkUserNamespace (client, namespace, quotas, localQueues) {
  // extract local queue names and compute GPU quota for namespace
  const clusterQueueNames = new Set() // accessible cluster queues without repetition
  const queueNames = [] // local queue names
  for (const localQueue of localQueues) {
    clusterQueueNames.add(localQueue.spec.clusterQueue)
    queueNames.push(localQueue.metadata.name)
  }
  let quota = 0 // gpu quota
  for (const clusterQueueName of clusterQueueNames) {
    quota += quotas[clusterQueueName]
  }

  const pods = await client.pods(namespace.metadata.name)
  const workloads = await client.workloads(namespace.metadata.name)

  let gpus = 0 // GPUs in use by scheduled pods
  for (const pod of pods) {
    gpus += reservation(pod)
  }

  // check every workload
  for (const workload of workloads) {
    // check queue name
    let queueName = workload.spec.queueName
    if (queueName) {
      if (!queueNames.includes(queueName)) {
        console.log(`- Workload "${namespace.metadata.name}/${workload.metadata.name}" refers to a non-existent queue "${queueName}"`)
      }
    } else {
      console.log(`- Workload "${namespace.metadata.name}/${workload.metadata.name}" is missing a queue name`)
    }
  }

  console.log(`Namespace "${namespace.metadata.name}" uses ${gpus} GPU(s) and has a quota of ${quota} GPU(s)`)
  console.log()
  return gpus
}

// identify pods using GPUs in system namespace and report total GPU usage for namespace
async function checkSystemNamespace (client, namespace) {
  const pods = await client.pods(namespace.metadata.name)

  let gpus = 0 // GPUs in use by scheduled pods
  for (const pod of pods) {
    const n = reservation(pod)
    if (n) {
      console.log(`- System pod "${namespace.metadata.name}/${pod.metadata.name}" uses ${n} GPU(s)`)
      gpus += n
    }
  }
  if (gpus > 0) {
    console.log(`System namespace "${namespace.metadata.name}" uses ${gpus} GPU(s) but has no quota`)
    console.log()
  }
  return gpus
}

async function main () {
  try {
    // initialize kubernetes client
    const client = new Client()

    let clusterGPUs = 0    // cluster capacity
    let noScheduleGPUs = 0 // unschedulable GPUs
    let noExecuteGPUs = 0  // no-execute GPUs
    let userGPUs = 0       // GPU usage by user namespaces
    let systemGPUs = 0     // GPU usage by system namespaces

    // load taint configuration
    const configMap = await client.readConfigMap('codeflare-operator-config', 'redhat-ods-applications')
    const config = k8s.loadYaml(configMap.data['config.yaml'])
    const taints = config.appwrapper?.Config?.autopilot?.resourceTaints?.['nvidia.com/gpu']

    // compute GPU counts
    const nodes = await client.nodes()
    for (const node of nodes) {
      const gpus = parseInt(node.status.capacity['nvidia.com/gpu'])
      if (gpus > 0) {
        clusterGPUs += gpus
        let noSchedule = false
        let noExecute = false
        for (const taint of taints ?? []) {
          if (node.metadata.labels?.[taint.key] === taint.value) {
            if (taint.effect === 'NoExecute') {
              noExecute = true
            } else if (taint.effect === 'NoSchedule') {
              noSchedule = true
            }
          }
        }
        for (const taint of node.spec.taints ?? []) {
          if (taint.effect === 'NoExecute') {
            noExecute = true
          } else if (taint.effect === 'NoSchedule') {
            noSchedule = true
          }
        }
        if (noExecute) {
          noExecuteGPUs += gpus
        } else if (noSchedule) {
          noScheduleGPUs += gpus
        }
      }
    }

    // compute GPU quotas for each cluster queue 
    const clusterQueues = await client.clusterQueues()
    const quotas = {}
    for (const clusterQueue of clusterQueues) {
      quotas[clusterQueue.metadata.name] = 0
      for (const resourceGroup of clusterQueue.spec.resourceGroups) {
        if (resourceGroup.coveredResources.includes('nvidia.com/gpu')) {
          for (const flavor of resourceGroup.flavors) {
            for (const resource of flavor.resources) {
              if (resource.name === 'nvidia.com/gpu') {
                quotas[clusterQueue.metadata.name] += resource.nominalQuota
                break // resource may only occur once in flavor
              }
            }
          }
          break // resource may only belong to one resource group
        }
      }
    }

    // check all namespaces
    const namespaces = await client.namespaces()
    for (const namespace of namespaces) {
      if (namespace.metadata.name.startsWith('openshift-')) {
        continue // skip openshift namespaces
      }

      const localQueues = await client.localQueues(namespace.metadata.name)

      if (localQueues.length === 0) {
        systemGPUs += await checkSystemNamespace(client, namespace)
      } else {
        userGPUs += await checkUserNamespace(client, namespace, quotas, localQueues)
      }
    }

    // print summary results
    console.log(`${clusterGPUs} GPU(s) in cluster`)
    if (noExecuteGPUs) {
      console.log(`${noExecuteGPUs} GPU(s) tainted NoExecute`)
    }
    if (noScheduleGPUs) {
      console.log(`${noScheduleGPUs} GPU(s) tainted NoSchedule`)
    }
    console.log(`${userGPUs} GPU(s) used by scheduled workloads`)
    if (systemGPUs > 0) {
      console.log(`${systemGPUs} GPU(s) used by system pods`)
    }

  } catch (e) {
    console.error(e)
  }
}

main()
