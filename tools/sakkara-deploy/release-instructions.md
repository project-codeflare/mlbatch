## Release Instructions

1. Create a release prep branch

2. Update the version number in chart/Chart.yaml

3. Do a `helm unittest -u chart` and then run precommit to
   regenerate the helmdocs.  Inspect the diff and make sure
   the only changes are the Chart version

4. Update the chart version number in the example
   of `helm repo search` in the main README.md

5. Submit & merge a PR with these changes

6. Manually trigger the `Release Charts` workflow in the Actions
   tab of the MLBatch GitHub project.  This action will automatically
   generate and push tags for the newly released chart and trigger an
   update of the GH Pages (which contains the helm repo).

