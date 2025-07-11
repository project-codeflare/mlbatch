.PHONY: all
all: docs

##@ General

# The help target prints out all targets with their descriptions organized
# beneath their categories. The categories are represented by '##@' and the
# target descriptions by '##'. The awk command is responsible for reading the
# entire set of makefiles included in this invocation, looking for lines of the
# file as xyz: ## something, and then pretty-format the target and help. Then,
# if there's a line with ##@ something, that gets pretty-printed as a category.
# More info on the usage of ANSI control characters for terminal formatting:
# https://en.wikipedia.org/wiki/ANSI_escape_code#SGR_parameters
# More info on the awk command:
# http://linuxcommand.org/lc3_adv_awk.php

.PHONY: help
help: ## Display this help.
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)


##@ Generate Documentation
docs: gotmpl
	../tools/gotmpl/gotmpl -input ./CLUSTER-SETUP.md.tmpl -output ../setup.RHOAI-v2.16/CLUSTER-SETUP.md -values RHOAI-v2.16.yaml
	../tools/gotmpl/gotmpl -input ./TEAM-SETUP.md.tmpl -output ../setup.RHOAI-v2.16/TEAM-SETUP.md -values RHOAI-v2.16.yaml
	../tools/gotmpl/gotmpl -input ./CLUSTER-SETUP.md.tmpl -output ../setup.RHOAI-v2.19/CLUSTER-SETUP.md -values RHOAI-v2.19.yaml
	../tools/gotmpl/gotmpl -input ./TEAM-SETUP.md.tmpl -output ../setup.RHOAI-v2.19/TEAM-SETUP.md -values RHOAI-v2.19.yaml
	../tools/gotmpl/gotmpl -input ./CLUSTER-SETUP.md.tmpl -output ../setup.RHOAI-v2.20/CLUSTER-SETUP.md -values RHOAI-v2.20.yaml
	../tools/gotmpl/gotmpl -input ./TEAM-SETUP.md.tmpl -output ../setup.RHOAI-v2.20/TEAM-SETUP.md -values RHOAI-v2.20.yaml
	../tools/gotmpl/gotmpl -input ./CLUSTER-SETUP.md.tmpl -output ../setup.RHOAI-v2.21/CLUSTER-SETUP.md -values RHOAI-v2.21.yaml
	../tools/gotmpl/gotmpl -input ./TEAM-SETUP.md.tmpl -output ../setup.RHOAI-v2.21/TEAM-SETUP.md -values RHOAI-v2.21.yaml
	../tools/gotmpl/gotmpl -input ./CLUSTER-SETUP.md.tmpl -output ../setup.k8s/CLUSTER-SETUP.md -values Kubernetes.yaml
	../tools/gotmpl/gotmpl -input ./TEAM-SETUP.md.tmpl -output ../setup.k8s/TEAM-SETUP.md -values Kubernetes.yaml


##@ Dependencies

.PHONY: gotmpl
gotmpl:	## Build gotmpl tool
	cd ../tools/gotmpl && go build ./...
