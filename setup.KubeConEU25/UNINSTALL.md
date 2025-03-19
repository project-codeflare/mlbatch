# Uninstall Procedure

```sh
kubectl delete appwrappers --all -A
kubectl delete pvc -n blue
kubectl delete pvc -n red

kubectl delete clusterqueues --all -A
kubectl delete localqueues --all -A
kubectl delete flavors --all -A

kubectl delete rolebinding -n blue alice
kubectl delete rolebinding -n red bob
kubectl delete ns blue red

kubectl delete -k setup.k8s/appwrapper/base
kubectl delete -k setup.k8s/kueue
kubectl delete -k setup.k8s/kuberay
kubectl delete -k setup.k8s/training-operator/base
kubectl delete ns mlbatch-system
kubectl delete clusterrole mlbatch-edit

helm uninstall -n scheduler-plugins scheduler-plugins
kubectl delete ns scheduler-plugins

helm uninstall -n autopilot autopilot
kubectl delete ns autopilot

helm uninstall -n prometheus kube-prometheus-stack
helm delete pvc -n prometheus --all
kubectl delete ns prometheus

helm uninstall -n nfs-provisioner pokprod
kubectl delete ns nfs-provisioner

# OpenShift-specific steps

oc adm policy remove-scc-from-user hostmount-anyuid \
  system:serviceaccount:nfs-provisioner:pokprod-nfs-subdir-external-provisioner

oc adm policy remove-scc-from-user privileged \
  system:serviceaccount:prometheus:kube-prometheus-stack-admission \
  system:serviceaccount:prometheus:kube-prometheus-stack-alertmanager \
  system:serviceaccount:prometheus:kube-prometheus-stack-grafana \
  system:serviceaccount:prometheus:kube-prometheus-stack-kube-state-metrics \
  system:serviceaccount:prometheus:kube-prometheus-stack-operator \
  system:serviceaccount:prometheus:kube-prometheus-stack-prometheus \
  system:serviceaccount:prometheus:kube-prometheus-stack-prometheus-node-exporter
```
