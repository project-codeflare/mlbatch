#!/bin/bash

echo "Waiting for install plan creation"
sleep 5
until oc get installplan -n redhat-ods-operator --ignore-not-found | grep install-
do
    echo -n "." && sleep 1;
done

plan_name=$(oc get installplan -n redhat-ods-operator --no-headers | awk '{print $1}')
echo "Approving install plan $plan_name"
oc patch installplan -n redhat-ods-operator --type merge --patch '{"spec":{"approved":true}}' $plan_name
