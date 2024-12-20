'use strict'

const k8s = require('@kubernetes/client-node')
const k8srp = require('kubernetes-resource-parser')

const nodeResources = {
  'nvidia.com/gpu': 8,
  'nvidia.com/roce_gdr': 2,
  cpu: 80,
  memory: '1100Gi'
}

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

  async readOperatorConfig () {
    const options = [
      { ns: 'redhat-ods-applications', cm: 'codeflare-operator-config', key: 'config.yaml', f: cm => cm.appwrapper?.Config },
      { ns: 'mlbatch-system', cm: 'appwrapper-operator-config', key: 'config.yaml', f: cm => cm.appwrapper },
      { ns: 'appwrapper-system', cm: 'appwrapper-operator-config', key: 'config.yaml', f: cm => cm.appwrapper }
    ]
    for (const opt of options) {
      try {
        const configMap = await this.readConfigMap(opt.cm, opt.ns)
        const cm = k8s.loadYaml(configMap.data[opt.key])
        return opt.f(cm)
      } catch (error) {
      }
    }
    console.log('WARNING: Failed to read operator config')
    return {}
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

// check container resource requests against node_resources
function checkContainerResources (namespace, workload, workloadReplicas, container) {
  // selectively merge limits into requests
  const resources = {}
  for (const k in container.resources?.requests ?? []) {
    resources[k] = container.resources.requests[k]
  }
  for (const k in container.resources?.limits ?? []) {
    if (!(k in resources)) {
      resources[k] = container.resources.limits[k]
    }
  }

  const gpus = parseInt(resources['nvidia.com/gpu'] ?? '0')
  const gdr = parseInt(resources['nvidia.com/roce_gdr'] ?? '0')
  const cpus = k8srp.cpuParser(resources.cpu ?? '0')
  const mem = k8srp.memoryParser(resources.memory ?? '0')

  // warn if the resource requests cannot be satisfied by a Node
  if (gpus > nodeResources['nvidia.com/gpu']) {
    console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has a container requesting "${gpus} GPUs"`)
  }
  if (gdr > nodeResources.gdrPerNode) {
    console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has a container requesting ${gdr} roce_gdr interfaces"`)
  }
  if (cpus > nodeResources.cpu) {
    console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has a container requesting "${cpus} CPUs"`)
  }
  if (mem > k8srp.memoryParser(nodeResources.memory)) {
    console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has a container requesting ${resources.memory} memory`)
  }

  // warn if the resource:GPU ratio is not proportional to Node resources
  if (gdr > 0 && ((gpus === 0) || (gpus / gdr < nodeResources['nvidia.com/gpu'] / nodeResources['nvidia.com/roce_gdr']))) {
    console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has a container requesting ${gdr} roce_gdr but only ${gpus} GPUs`)
  }
  if (gpus > 0 && (cpus > 0) && (cpus / gpus > nodeResources.cpu / nodeResources['nvidia.com/gpu'])) {
    console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has a container requesting ${cpus} cpus but only ${gpus} GPUs`)
  }
  if (gpus > 0 && (mem > 0) && (mem / gpus > k8srp.memoryParser(nodeResources.memory) / nodeResources['nvidia.com/gpu'])) {
    console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has a container requesting ${resources.memory} memory but only ${gpus} GPUs`)
  }

  // warn if other resource constraints are violated
  if (gdr > 0 && workloadReplicas < 2) {
    console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" is a single pod workload that is requesting ${gdr} roce_gdr`)
  }
}

// check user namespace
async function checkUserNamespace (client, namespace, queues) {
  const workloads = await client.workloads(namespace.metadata.name)

  for (const workload of workloads) {
    // report invalid queue names
    const queueName = workload.spec.queueName
    if (queueName) {
      if (!queues.find(queue => queue.metadata.name === queueName)) {
        console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" refers to a non-existent local queue "${queueName}"`)
      }
    } else {
      console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" is missing a local queue name`)
    }

    // report high-priority workloads
    if (workload.spec.priorityClassName !== 'default-priority' && workload.spec.priorityClassName !== 'low-priority') {
      console.log(`NOTE: workload "${namespace.metadata.name}/${workload.metadata.name}" has priority "${workload.spec.priorityClassName}"`)
    }

    // report unusual conditions
    const conditions = {}
    for (const condition of workload.status?.conditions ?? []) {
      conditions[condition.type] = condition.status
    }
    if (conditions.Finished !== 'True') {
      if (conditions.Admitted === 'True' && conditions.PodsReady === 'False') {
        console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has conditions Admitted=True and PodsReady=False`)
      }
      if (conditions.Evicted === 'True') {
        console.log(`WARNING: workload "${namespace.metadata.name}/${workload.metadata.name}" has condition Evicted=True`)
      }
    }

    // report misconfigured resource requests
    let replicas = 0
    for (const podSet of workload.spec?.podSets) {
      replicas += podSet.count ?? 0
    }
    for (const podSet of workload.spec?.podSets) {
      for (const ic of podSet.template?.spec?.initContainers ?? []) {
        checkContainerResources(namespace, workload, replicas, ic)
      }
      for (const c of podSet.template?.spec?.containers ?? []) {
        checkContainerResources(namespace, workload, replicas, c)
      }
    }
  }

  // report GPU pods using default scheduler
  const pods = await client.pods(namespace.metadata.name)
  for (const pod of pods) {
    if (pod.spec.schedulerName === 'default-scheduler' && reservation(pod) > 0) {
      console.log(`WARNING: pod "${namespace.metadata.name}/${pod.metadata.name}" is using default-scheduler`)
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

    let clusterGPUs = 0 // cluster capacity
    let noScheduleGPUs = 0 // no-schedule GPUs
    let noExecuteGPUs = 0 // no-execute GPUs
    let usedGPUs = 0 // GPU usage by admitted workloads
    let borrowedGPUs = 0 // GPU borrowed from the cohort
    let quotaGPUs = 0 // nominal GPU quota (excluding slack queue)
    let limitGPUs = 0 // lending limit on slack queue
    let slackGPUs = 0 // nominal GPU quota on slack queue

    const config = await client.readOperatorConfig()
    const taints = config.autopilot?.resourceTaints?.['nvidia.com/gpu']
    const slackQueueName = config.slackQueueName

    let newline = false

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
              console.log(`WARNING: node "${node.metadata.name}" has label "${taint.key}"="${taint.value}" with effect "${taint.effect}"`)
              newline = true
              node.noExecute = true
            } else if (taint.effect === 'NoSchedule') {
              console.log(`WARNING: node "${node.metadata.name}" has label "${taint.key}"="${taint.value}" with effect "${taint.effect}"`)
              newline = true
              node.noSchedule = true
            }
          }
        }
        for (const taint of node.spec.taints ?? []) {
          if (taint.effect === 'NoExecute') {
            console.log(`WARNING: node "${node.metadata.name}" has taint "${taint.key}" with effect "${taint.effect}"`)
            newline = true
            node.noExecute = true
          } else if (taint.effect === 'NoSchedule') {
            console.log(`WARNING: node "${node.metadata.name}" has taint "${taint.key}" with effect "${taint.effect}"`)
            newline = true
            node.noSchedule = true
          }
        }
        if (node.noExecute) {
          noExecuteGPUs += gpus
        } else if (node.noSchedule) { // no double counting
          noScheduleGPUs += gpus
        }
      }
    }

    if (newline) {
      console.log()
    }

    // collect cluster queue metrics
    const clusterQueues = await client.clusterQueues()
    const queues = {}
    for (const clusterQueue of clusterQueues) {
      const queue = {
        quota: 0,
        usage: 0,
        borrowed: 0,
        lendingLimit: 0,
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
        slackGPUs = queue.quota
        limitGPUs = queue.lendingLimit
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
    console.log(`Maximum slack GPU quota:         + ${pad(slackGPUs, width)}`)
    console.log(`Slack GPU quota adjustment:      - ${pad(slackGPUs - limitGPUs, width)}`)
    console.log(`Current GPU quota:               = ${pad(quotaGPUs + limitGPUs, width)}`)
    console.log()
    console.log(`GPU usage by admitted workloads:   ${pad(usedGPUs, width)}`)
    console.log(`Borrowed GPU count:                ${pad(borrowedGPUs, width)}`)
    console.log()

    if (quotaGPUs > clusterGPUs - noExecuteGPUs - noScheduleGPUs) {
      console.log('WARNING: nominal GPU quota is greater than schedulable GPU count')
    }

    if (quotaGPUs + slackGPUs < clusterGPUs) {
      console.log('WARNING: maximum GPU quota is lower than total GPU count')
    }

    if (quotaGPUs + slackGPUs > clusterGPUs) {
      console.log('WARNING: maximum GPU quota is greater than total GPU count')
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
