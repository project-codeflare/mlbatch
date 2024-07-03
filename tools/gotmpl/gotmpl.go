package main

import (
	"flag"
	"log"
	"os"
	"text/template"

	"sigs.k8s.io/yaml"
)

func main() {
	var input string
	var output string
	var values string
	flag.StringVar(&input, "input", "", "The input template file")
	flag.StringVar(&output, "output", "", "The output file")
	flag.StringVar(&values, "values", "", "The values.yaml file")

	flag.CommandLine.SetOutput(os.Stderr)
	flag.Parse()

	if input == "" {
		log.Fatal("Must provide input template filename")
	}

	if output == "" {
		log.Fatal("Must provide output filename")
	}

	if values == "" {
		log.Fatal("Must provide input values filename")
	}

	tmpl, err := template.ParseFiles(input)
	if err != nil {
		log.Fatalf("Parsing input template: %v", err)
	}

	valueBytes, err := os.ReadFile(values)
	if err != nil {
		log.Fatalf("Reading values: %v", err)
	}
	var vals map[string]interface{}
	err = yaml.Unmarshal(valueBytes, &vals)
	if err != nil {
		log.Fatalf("Processing values: %v", err)
	}

	outfile, err := os.Create(output)
	if err != nil {
		log.Fatalf("Creating output file: %v", err)
	}

	tmpl.Execute(outfile, vals)
}
