# Uninstall

To uninstall the MLBatch controllers and reclaim the corresponding namespaces,
do the following:
```sh
# Delete operators and CRDs
kubectl delete -k setup.k8s-v1.25/appwrapper
kubectl delete -k setup.k8s-v1.25/kueue
kubectl delete -k setup.k8s-v1.25/kuberay
kubectl delete -k setup.k8s-v1.25/training-operator

# Delete namespace
kubectl delete namespace mlbatch-system

# Delete clusterole
kubectl delete clusterrole mlbatch-edit

# Coscheduler uninstall
helm uninstall -n scheduler-plugins scheduler-plugins
kubectl delete namespace scheduler-plugins
```
