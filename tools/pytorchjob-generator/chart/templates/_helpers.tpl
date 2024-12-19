# This file factors out code snippets that are duplicated in both the Master and Worker templates.

{{- define "mlbatch.customLabels" }}
{{- if .Values.customLabels }}
{{- range $customLabel := .Values.customLabels }}
{{ $customLabel.key }}: {{ $customLabel.value }}
{{- end }}
{{- end }}
{{- end -}}


{{- define "mlbatch.container.metadata" }}
{{- if or .Values.customLabels .Values.autopilotHealthChecks }}
labels:
    {{- include "mlbatch.customLabels" . | indent 4 }}
    {{- if .Values.autopilotHealthChecks }}
    autopilot: ""
      {{- range $healthcheck := .Values.autopilotHealthChecks }}
    {{ $healthcheck }}: ""
      {{- end }}
    {{- end }}
{{- end }}
{{- if .Values.multiNicNetworkName }}
annotations:
    k8s.v1.cni.cncf.io/networks: {{ .Values.multiNicNetworkName }}
{{- end }}
{{- end -}}


{{- define "mlbatch.schedulingSpec" }}
{{- if ne .Values.terminationGracePeriodSeconds nil }}
terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}
{{- end }}
{{- if .Values.bypassCoscheduler }}
schedulerName: default-scheduler
{{- end }}
priorityClassName: {{ .Values.priority }}
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
{{- if .Values.hostIgnoreList }}
        - key: kubernetes.io/hostname
          operator: NotIn
          values:
          {{- range $host := .Values.hostIgnoreList }}
          - {{ $host }}
          {{- end }}
{{- end }}
{{- end -}}


{{- define "mlbatch.resources" }}
resources:
    requests:
        cpu: {{ .Values.numCpusPerPod }}
        nvidia.com/gpu: {{ .Values.numGpusPerPod }}
        memory: {{ .Values.totalMemoryPerPod }}
        {{ .Values.roceGdrResName | default "nvidia.com/roce_gdr" }}: {{ .Values.numRoceGdr | default 0 }}
    limits:
        cpu: {{ .Values.limitCpusPerPod | default .Values.numCpusPerPod }}
        nvidia.com/gpu: {{ .Values.limitGpusPerPod | default .Values.numGpusPerPod }}
        memory: {{ .Values.limitMemoryPerPod | default .Values.totalMemoryPerPod }}
        {{ .Values.roceGdrResName | default "nvidia.com/roce_gdr" }}: {{ .Values.numRoceGdr | default 0 }}
{{- end -}}


{{- define "mlbatch.env" }}
{{- if .Values.ncclGdrEnvConfigMap }}
envFrom:
  - configMapRef:
      name: {{ .Values.ncclGdrEnvConfigMap }}
{{- end }}
{{- if or .Values.environmentVariables .Values.sshGitCloneConfig .Values.mountNVMe .Values.topologyFileConfigMap }}
env:
    {{- if .Values.topologyFileConfigMap }}
    - name: NCCL_TOPO_FILE
      value: /var/run/nvidia-topologyd/virtualTopology.xml
    {{- end }}
    {{- if .Values.mountNVMe }}
    - name: NVME_MOUNT_PATH
      {{- if .Values.mountNVMe.mountPath }}
      value: {{ .Values.mountNVMe.mountPath | quote }}
      {{- else }}
      value: "/workspace/scratch-nvme"
      {{- end }}
    {{- end }}
    {{- range $variable := .Values.environmentVariables }}
    - name: {{ required "Missing 'name' in 'environmentVariables' list element" $variable.name }}
      {{- if $variable.value }}
      value: {{ $variable.value | quote }}
      {{- else if $variable.secret }}
      valueFrom:
          secretKeyRef:
              name: {{ required "Missing 'name' in 'environmentVariables.secret' list element" $variable.secret.name }}
              key: {{ required "Missing 'key' in 'environmentVariables.secret' list element" $variable.secret.key | quote }}
      {{- else if ( kindIs "float64" $variable.value ) }}
      value: "0"
      {{- else }}
      value: {{ required "Missing 'value' in 'environmentVariables' list element" "" }}
      {{- end }}
    {{- end }}
    {{- if .Values.sshGitCloneConfig }}
    - name: GIT_SSH_COMMAND
      {{- if .Values.sshGitCloneConfig.sshCmd }}
      value: {{ .Values.sshGitCloneConfig.sshCmd | quote }}
      {{- else if .Values.sshGitCloneConfig.secretMountPath }}
      {{- if .Values.sshGitCloneConfig.configMapMountPath }}
      value: "ssh -i {{ .Values.sshGitCloneConfig.secretMountPath }}/id_rsa -o UserKnownHostsFile={{ .Values.sshGitCloneConfig.configMapMountPath }}/known_hosts -vv"
      {{- else }}
      value: "ssh -i {{ .Values.sshGitCloneConfig.secretMountPath }}/id_rsa -o UserKnownHostsFile=/tmp/.ssh/hosts/known_hosts -vv"
      {{- end }}
      {{- else if .Values.sshGitCloneConfig.configMapMountPath }}
      value: "ssh -i /tmp/.ssh/keys/id_rsa -o UserKnownHostsFile={{ .Values.sshGitCloneConfig.configMapMountPath }}/known_hosts -vv"
      {{- else }}
      value: "ssh -i /tmp/.ssh/keys/id_rsa -o UserKnownHostsFile=/tmp/.ssh/hosts/known_hosts -vv"
      {{- end }}
    {{- end }}
{{- else }}
env: []
{{- end }}
{{- end -}}


{{- define "mlbatch.command" }}
command:
    - sh
    - -c
    - |
      echo "Environment variables set by the kubeflow training operator:"
      echo ${MASTER_ADDR}:${MASTER_PORT}
      echo "PYTHONUNBUFFERED:"${PYTHONUNBUFFERED}
      echo My global rank is ${RANK} / ${WORLD_SIZE}
      echo "Other injected environment variables:"
      echo "NVME_MOUNT_PATH: "${NVME_MOUNT_PATH}
      #
      # User commands
      #
      {{- range $command := .Values.setupCommands }}
      {{ $command }}
      {{- end }}
      {{- if .Values.mainProgram }}
      {{- if gt ( int .Values.numGpusPerPod ) 0 }}
      echo executing: torchrun --nnodes=${WORLD_SIZE} --node_rank=${RANK} --nproc_per_node={{ .Values.numGpusPerPod }} --rdzv_id=101 --rdzv_endpoint="${MASTER_ADDR}:${MASTER_PORT}" {{ .Values.mainProgram }}
      torchrun --nnodes=${WORLD_SIZE} --node_rank=${RANK} --nproc_per_node={{ .Values.numGpusPerPod }} --rdzv_id=101 --rdzv_endpoint="${MASTER_ADDR}:${MASTER_PORT}" {{ .Values.mainProgram }}
      {{- else }}
      echo executing: torchrun --nnodes=${WORLD_SIZE} --node_rank=${RANK} --rdzv_id=101 --rdzv_endpoint="${MASTER_ADDR}:${MASTER_PORT}" {{ .Values.mainProgram }}
      torchrun --nnodes=${WORLD_SIZE} --node_rank=${RANK} --rdzv_id=101 --rdzv_endpoint="${MASTER_ADDR}:${MASTER_PORT}" {{ .Values.mainProgram }}
      {{- end }}
      {{- end }}
{{- end -}}


{{- define "mlbatch.volumeMounts" }}
{{- if or .Values.volumes .Values.sshGitCloneConfig ( not .Values.disableSharedMemory ) .Values.mountNVMe }}
volumeMounts:
    {{- if .Values.topologyFileConfigMap }}
    - name: topology-volume
      mountPath: /var/run/nvidia-topologyd
    {{- end }}
    {{- if .Values.mountNVMe }}
    - name: ephemeral-odf-lvm-vg1
      {{- if .Values.mountNVMe.mountPath }}
      mountPath: {{ .Values.mountNVMe.mountPath | quote }}
      {{- else }}
      mountPath: "/workspace/scratch-nvme"
      {{- end }}
    {{- end }}
    {{- range $volume := .Values.volumes }}
    - name: {{ required "Missing 'name' in 'volumes' list element" $volume.name }}
      mountPath: {{ required "Missing 'mountPath' in 'volumes' list element" $volume.mountPath }}
    {{- end }}
    {{- if .Values.sshGitCloneConfig }}
    - name: private-ssh-git-deploy-key
      readOnly: true
      {{- if .Values.sshGitCloneConfig.secretMountPath }}
      mountPath: {{ .Values.sshGitCloneConfig.secretMountPath }}
      {{- else }}
      mountPath: "/tmp/.ssh/keys"
      {{- end }}
    - name: github-known-hosts
      {{- if .Values.sshGitCloneConfig.configMapMountPath }}
      mountPath: {{ .Values.sshGitCloneConfig.configMapMountPath }}
      {{- else }}
      mountPath: "/tmp/.ssh/hosts"
      {{- end }}
    {{- end }}
    {{- if eq .Values.disableSharedMemory false }}
    - name: dshm
      mountPath: "/dev/shm"
    {{- end }}
{{- else }}
volumeMounts: []
{{- end }}
{{- end -}}


{{- define "mlbatch.volumes" }}
{{- if or .Values.volumes .Values.sshGitCloneConfig ( not .Values.disableSharedMemory ) .Values.mountNVMe }}
volumes:
    {{- if .Values.topologyFileConfigMap }}
    - name: topology-volume
      configMap:
        name: {{ .Values.topologyFileConfigMap }}
    {{- end }}
    {{- if .Values.mountNVMe }}
    - name: ephemeral-odf-lvm-vg1
      ephemeral:
        volumeClaimTemplate:
          spec:
            storageClassName: odf-lvm-vg1
            volumeMode: Filesystem
            accessModes: [ "ReadWriteOnce" ]
            resources:
              requests:
                storage: {{ .Values.mountNVMe.storage }}
    {{- end }}
    {{- range $volume := .Values.volumes }}
    - name: {{ required "Missing 'name' in 'volumes' list element" $volume.name }}
      persistentVolumeClaim:
          claimName: {{ required "Missing 'claimName' in 'volumes' list element" $volume.claimName }}
    {{- end }}
    {{- if .Values.sshGitCloneConfig }}
    - name: private-ssh-git-deploy-key
      secret:
          secretName: {{ required "Missing 'secretName' in 'sshGitCloneConfig' " .Values.sshGitCloneConfig.secretName }}
          optional: false
    - name: github-known-hosts
      configMap:
          name: {{ required "Missing 'configMapName' in 'sshGitCloneConfig' " .Values.sshGitCloneConfig.configMapName }}
    {{- end }}

{{- if eq .Values.disableSharedMemory false }}
    - name: dshm
      emptyDir:
          medium: Memory
    {{- end }}
{{- else }}
volumes: []
{{- end }}
{{- end -}}


{{- define "mlbatch.initContainers" }}
{{- if .Values.initContainers }}
initContainers:
    {{- range $container := .Values.initContainers }}
    - name: {{ required "Missing 'name' of initContainer" $container.name }}
      image: {{ required "Missing 'image' of initContainer" $container.image }}
      {{- if ( required "Missing 'command' array of initContainer" $container.command ) }}
      {{- if kindIs "string" $container.command }}
      command: {{ $container.command }}
      {{- else }}
      command:
          {{- range $command := $container.command }}
          - {{ $command }}
          {{- end }}
      {{- end }}
      {{- end }}
    {{- end }}
{{- end }}
{{- end -}}


{{- define "mlbatch.imagePullSecrets" }}
{{- if .Values.imagePullSecrets }}
imagePullSecrets:
    {{- range $secret := .Values.imagePullSecrets }}
    - name: {{ $secret.name }}
    {{- end }}
{{- else }}
imagePullSecrets: []
{{- end }}
{{- end -}}


{{- define "mlbatch.securityContext" }}
{{- if or (gt ( int .Values.numRoceGdr ) 0) (eq .Values.serviceAccountName "gdr") }}
securityContext:
  capabilities:
    add:
    - IPC_LOCK
{{- end }}
{{- end -}}
