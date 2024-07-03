# Uninstall

To uninstall the MLBatch controllers and reclaim the corresponding namespaces,
run:
```sh
# OpenShift AI uninstall
oc delete dsc mlbatch-dsc
oc delete dsci mlbatch-dsci
oc delete subscription -n redhat-ods-operator rhods-operator
oc delete csv -n redhat-ods-operator -l operators.coreos.com/rhods-operator.redhat-ods-operator
oc delete crd featuretrackers.features.opendatahub.io \
  dscinitializations.dscinitialization.opendatahub.io \
  datascienceclusters.datasciencecluster.opendatahub.io
oc delete operators rhods-operator.redhat-ods-operator
oc delete operatorgroup -n redhat-ods-operator rhods-operator
oc delete namespace redhat-ods-applications redhat-ods-monitoring redhat-ods-operator

# Coscheduler uninstall
helm uninstall -n scheduler-plugins scheduler-plugins
oc delete namespace scheduler-plugins
```
