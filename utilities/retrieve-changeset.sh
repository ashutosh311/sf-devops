#!/bin/bash

# Author: Rich Beadle (Slalom)
# Usage: Used to retrieve metadata components from a Change Set prepared in source environment. 

# Use the first command-line argument as the Change Set Name if provided
if [ -n "$1" ]; then
  changeSetName="$1"
else
  # Prompt the user for the package name
  read -rp "Enter the Change Set name to retrieve: " changeSetName

  # Check if the input is empty
  if [ -z "$changeSetName" ]; then
    echo "Error: Change Set name cannot be empty."
    exit 1
  fi
fi

# Run the Salesforce CLI retrieve commands
sf project retrieve start --target-metadata-dir manifest --unzip --package-name "$packageName" # Retrieve package and unzip into temporary folder
sf project retrieve start --manifest manifest/unpackaged/"$packageName"/package.xml --ignore-conflicts # Returned files are in metadata api format. Use the package.xml to retrieve source formatted files.
rm -r manifest/unpackaged/"$packageName"