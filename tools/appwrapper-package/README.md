# AppWrapper Packager

The Python script in this directory takes as input a YAML file
containing one or more Kubernetes resources and generates
an output YAML file with an AppWrapper containing the input
resources.

Example invocation:
```sh
./awpack.py -i input.yaml -o aw.yaml -n my-appwrapper
```

Usage information:
```sh
usage: awpack.py [-h] -i INPUT [-n NAME] [-o OUTPUT]

Wrap Resources in an AppWrapper

options:
  -h, --help            show this help message and exit
  -i INPUT, --input INPUT
                        input YAML file
  -n NAME, --name NAME  name of AppWrapper
  -o OUTPUT, --output OUTPUT
                        output file
```
