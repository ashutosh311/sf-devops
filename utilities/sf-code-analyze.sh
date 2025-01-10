#!/bin/bash

# Author: Stuart Grieve (Slalom)

function analyzeCode {

    echo "Running Salesforce Code Analyzer on changed files..."; echo ""

    # Throw failure if script hits error
    set -e

    workspace="$1"

    # Install dependencies
    npm install
    sf plugins install code-analyzer@latest

    # Run code analyzer on workspace (for Pull Requests this should be a delta directory)
    sf code-analyzer run --rule-selector All --severity-threshold 2 --workspace $workspace --view table

}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 1 ]]; then
    echo ""; echo "===============================================";
    echo "Run Salesforce Code Analyzer Plugin"
    echo "==============================================="; echo ""
    echo "Usage: run-eslint.sh <workspace>"; echo ""
    echo "Where:"
    echo "    <workspace> is the directory of files to scan"; echo ""
    echo "For example: sf-code-analyze.sh delta-directory/"; echo ""
    exit 0
else
    analyzeCode "$@"
fi