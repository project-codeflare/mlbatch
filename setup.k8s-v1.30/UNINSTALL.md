# Uninstall

***First, remove all team namespaces and corresponding cluster queues.***

Then to uninstall the MLBatch controllers and reclaim the corresponding
namespaces, do the following:
```sh
# Delete operators and CRDs
kubectl delete -k setup.k8s-v1.30/appwrapper
kubectl delete -k setup.k8s-v1.30/kueue
kubectl delete -k setup.k8s-v1.30/kuberay
kubectl delete -k setup.k8s-v1.30/training-operator

# Delete namespace
kubectl delete namespace mlbatch-system

# Delete clusterole and admission policy
kubectl delete clusterrole mlbatch-edit
kubectl delete -f setup.k8s-v1.30/admission-policy.yaml

# Coscheduler uninstall
helm uninstall -n scheduler-plugins scheduler-plugins
kubectl delete namespace scheduler-plugins
```
