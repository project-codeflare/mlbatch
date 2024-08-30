#!/usr/bin/env python

import os
import string
import argparse
from pathlib import Path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Wrap Resources in an AppWrapper"
    )
    parser.add_argument("-i", "--input", type=str, help="input YAML file", required=True)
    parser.add_argument("-n", "--name", type=str, help="name of AppWrapper", default="sample-appwrapper")
    parser.add_argument("-o", "--output", type=str, help="output file", default="aw.yaml")
    args = parser.parse_args()

    new_object = True

    with open(args.output, mode="w") as output_file:
        with open(args.input) as input_file:
            output_file.write("apiVersion: workload.codeflare.dev/v1beta2\n")
            output_file.write("kind: AppWrapper\n")
            output_file.write("metadata:\n")
            output_file.write(f"  name: {args.name}\n")
            output_file.write("  labels:\n")
            output_file.write("    kueue.x-k8s.io/queue-name: default-queue\n")
            output_file.write("spec:\n")
            output_file.write("  components:\n")
            while True:
                line = input_file.readline()
                if not line:
                    break
                if line.startswith("---"):
                    new_object = True
                    continue
                if line == "\n":
                    continue
                if new_object:
                    output_file.write("  - template:\n")
                    new_object = False
                output_file.write("      "+line)
