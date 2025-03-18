# Uninstall

***First, remove all team namespaces and corresponding cluster queues.***

Then to uninstall the MLBatch controllers and reclaim the corresponding
namespaces, do the following:
```sh
# Delete operators and CRDs
kubectl delete -k setup.k8s/appwrapper/base
kubectl delete -k setup.k8s/kueue
kubectl delete -k setup.k8s/kuberay
kubectl delete -k setup.k8s/training-operator/base

# Delete namespace
kubectl delete namespace mlbatch-system

# Delete clusterole
kubectl delete clusterrole mlbatch-edit

# Coscheduler uninstall
helm uninstall -n scheduler-plugins scheduler-plugins
kubectl delete namespace scheduler-plugins

# Sakkara uninstall
helm uninstall -n sakkara-scheduler sakkara-scheduler
kubectl delete namespace sakkara-scheduler
```
