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

// pad value with spaces to the left
function pad (v, n) {
  return String(v ?? '').padStart(n)
}

// format and print table
function printTable (table, kind, ...columns) {
  const widths = { name: kind.length } // column widths
  const names = Object.keys(table).sort() // object names

  // compute column widths
  for (const name of names) {
    widths.name = Math.max(widths.name, name.length)
    for (const column of columns) {
      widths[column[1]] = Math.max(widths[column[1]] ?? column[0].length, String(table[name][column[0]] ?? '').length)
    }
  }

  // print table header
  let header = kind.toUpperCase().padEnd(widths.name, ' ')
  for (const column of columns) {
    header += '   ' + pad(column[0].toUpperCase(), widths[column[1]])
  }
  console.log(header)

  // print table rows
  for (const name of names) {
    let row = name.padEnd(widths.name, ' ')
    for (const column of columns) {
      row += '   ' + pad(table[name][column[1]], widths[column[1]])
    }
    console.log(row)
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
  // compute sum of container gpu limits
  for (const container of pod.spec.containers) {
    gpus += parseInt(container.resources?.limits?.['nvidia.com/gpu'] ?? '0')
  }
  // compute max with init container gpu limits
  for (const container of pod.spec.initContainers ?? []) {
    gpus = Math.max(gpus, parseInt(container.resources?.limits?.['nvidia.com/gpu'] ?? '0'))
  }
  return gpus
}

// check user namespace
async function checkUserNamespace (client, namespace, queues) {
  const workloads = await client.workloads(namespace.metadata.name)

  for (const workload of workloads) {
    // report invalid queue names
    let queueName = workload.spec.queueName
    if (queueName) {
      if (!queues.find(queue => queue.metadata.name === queueName)) {
        console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" refers to a non-existent local queue "${queueName}"`)
      }
    } else {
      console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" is missing a local queue name`)
    }

    // report high-priority workloads
    if (workload.spec.priorityClassName !== 'default-priority' && workload.spec.priorityClassName !== 'low-priority') {
      console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has priority "${workload.spec.priorityClassName}"`)
    }

    // report unusual conditions
    const conditions = {}
    for (const condition of workload.status?.conditions ?? []) {
      conditions[condition.type] = condition.status
    }
    if (conditions['Admitted'] === 'True' && conditions['PodsReady'] === 'False') {
      console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has conditions Admitted=True and PodsReady=False`)
    }
    if (conditions['Evicted'] === 'True') {
      console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has condition Evicted=True`)
    }
  }
}

// check system namespace
async function checkSystemNamespace (client, namespace, nodes) {
  const pods = await client.pods(namespace.metadata.name)

  for (const pod of pods) {
    // report GPU occupancy
    const gpus = reservation(pod)
    if (gpus) {
      const node = nodes.find(node => node.metadata.name === pod.spec.nodeName)
      console.log(`WARNING: pod "${namespace.metadata.name}/${pod.metadata.name}" occupies ${gpus} GPU(s)` +
        `on node "${pod.spec.nodeName}" with GPU taints noExecute=${node?.noExecute} and noSchedule=${node?.noSchedule}`)
    }
  }
}

async function main () {
  try {
    // initialize kubernetes client
    const client = new Client()

    let clusterGPUs = 0    // cluster capacity
    let noScheduleGPUs = 0 // no-schedule GPUs
    let noExecuteGPUs = 0  // no-execute GPUs
    let usedGPUs = 0       // GPU usage by admitted workloads
    let borrowedGPUs = 0   // GPU borrowed from the cohort
    let quotaGPUs = 0      // nominal GPU quota (excluding slack queue)
    let slackGPUs = 0      // lending limit on slack queue

    // load codeflare operator configuration
    const configMap = await client.readConfigMap('codeflare-operator-config', 'redhat-ods-applications')
    const config = k8s.loadYaml(configMap.data['config.yaml'])
    const taints = config.appwrapper?.Config?.autopilot?.resourceTaints?.['nvidia.com/gpu']
    const slackQueueName = config.appwrapper?.Config?.slackQueueName

    // compute GPU counts
    const nodes = await client.nodes()
    for (const node of nodes) {
      const gpus = parseInt(node.status.capacity['nvidia.com/gpu'] ?? '0')
      if (gpus > 0) {
        clusterGPUs += gpus
        node.noSchedule = false
        node.noExecute = false
        for (const taint of taints ?? []) {
          if (node.metadata.labels?.[taint.key] === taint.value) {
            if (taint.effect === 'NoExecute') {
              node.noExecute = true
            } else if (taint.effect === 'NoSchedule') {
              node.noSchedule = true
            }
          }
        }
        for (const taint of node.spec.taints ?? []) {
          if (taint.effect === 'NoExecute') {
            node.noExecute = true
          } else if (taint.effect === 'NoSchedule') {
            node.noSchedule = true
          }
        }
        if (node.noExecute) {
          node.noExecuteGPUs += gpus
        } else if (node.noSchedule) { // no double counting
          node.noScheduleGPUs += gpus
        }
      }
    }

    // collect cluster queue metrics
    const clusterQueues = await client.clusterQueues()
    const queues = {}
    for (const clusterQueue of clusterQueues) {
      const queue = {
        quota: 0, usage: 0, borrowed: 0, lendingLimit: 0,
        admitted: clusterQueue.status?.admittedWorkloads ?? 0,
        pending: clusterQueue.status?.pendingWorkloads ?? 0
      }
      for (const resourceGroup of clusterQueue.spec.resourceGroups) {
        if (resourceGroup.coveredResources.includes('nvidia.com/gpu')) {
          for (const flavor of resourceGroup.flavors) {
            for (const resource of flavor.resources) {
              if (resource.name === 'nvidia.com/gpu') {
                queue.quota += parseInt(resource.nominalQuota ?? '0')
                // lending limit is nominal quota if not set
                queue.lendingLimit += parseInt(resource.lendingLimit ?? resource.nominalQuota ?? '0')
                break // resource may only occur once in flavor
              }
            }
          }
          break // resource may only belong to one resource group
        }
      }
      for (const flavor of clusterQueue.status?.flavorsUsage ?? []) {
        for (const resource of flavor.resources) {
          if (resource.name === 'nvidia.com/gpu') {
            queue.usage += parseInt(resource.total ?? '0')
            queue.borrowed += parseInt(resource.borrowed ?? '0')
            break // resource may only occur once in flavor
          }
        }
      }
      usedGPUs += queue.usage
      borrowedGPUs += queue.borrowed
      if (clusterQueue.metadata.name === slackQueueName) {
        slackGPUs = queue.lendingLimit
        // do not include slack queue in table
      } else {
        quotaGPUs += queue.quota
        queues[clusterQueue.metadata.name] = queue
      }
    }

    // print cluster queue table
    printTable(queues, 'cluster queue', ['gpu quota', 'quota'], ['gpu usage', 'usage'],
      ['admitted workloads', 'admitted'], ['pending workloads', 'pending'])
    console.log()

    // print summary results
    const width = Math.max(String(clusterGPUs).length, String(quotaGPUs).length)
    console.log(`Total GPU count in cluster:        ${pad(clusterGPUs, width)}`)
    console.log(`Unschedulable GPU count:         - ${pad(noExecuteGPUs + noScheduleGPUs, width)}`)
    console.log(`Schedulable GPU count:           = ${pad(clusterGPUs - noExecuteGPUs - noScheduleGPUs, width)}`)
    console.log()
    console.log(`Nominal GPU quota:                 ${pad(quotaGPUs, width)}`)
    console.log(`Slack GPU quota:                 + ${pad(slackGPUs, width)}`)
    console.log(`Total GPU quota:                 = ${pad(quotaGPUs + slackGPUs, width)}`)
    console.log()
    console.log(`GPU usage by admitted workloads:   ${pad(usedGPUs, width)}`)
    console.log(`Borrowed GPU count:                ${pad(borrowedGPUs, width)}`)
    console.log()

    if (quotaGPUs > clusterGPUs - noExecuteGPUs - noScheduleGPUs) {
      console.log('WARNING: nominal GPU quota is greater than schedulable GPU count')
    }

    // check all accessible namespaces
    const namespaces = await client.namespaces()
    for (const namespace of namespaces) {
      if (namespace.metadata.name.startsWith('openshift-')) {
        continue // skip openshift namespaces
      }

      let localQueues
      try {
        localQueues = await client.localQueues(namespace.metadata.name)
      } catch (err) {
        continue // skip inaccessible namespaces
      }

      if (localQueues.length === 0) {
        await checkSystemNamespace(client, namespace, nodes)
      } else {
        await checkUserNamespace(client, namespace, localQueues)
      }
    }
  } catch (err) {
    console.error(err)
  }
}

main()
