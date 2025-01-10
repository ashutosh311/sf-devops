#!/bin/bash

# Author: Stuart Grieve (Slalom)

function generateDelta {

    echo "Generate a delta deployment directory from the last deployed Commit in Org..."; echo ""

    # Throw failure if script hits error
    set -e

    outputDir="$1"
    envConfigCommitId="$2"
    currentBranch="$3"

    # Create delta deployment folder
    mkdir -p $outputDir

    # Install SF CLI Git Delta plugin
    echo y | sf plugins install sfdx-git-delta

    if [ $envConfigCommitId == "" ]; then
        echo "No environment config commit provided, doing a full deployment instead..."; echo ""
        # Copy contents of force-app folder into output directory since that's where the deployment is configured to run from
        cp -r force-app* $outputDir
    else
        # Generate delta based on current git ref and the commit Id retrieved from org
        sf sgd:source:delta --from $envConfigCommitId --to $currentBranch --output-dir $outputDir --generate-delta
    
    
}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 3 ]]; then
    echo ""; echo "===============================================";
    echo "Generate Delta Directory from Org's Commit Id"
    echo "==============================================="; echo ""
    echo "Usage: generate-delta.sh <outputDir> <envConfigCommitId> <currentBranch>"; echo ""
    echo "Where:"
    echo "    <outputDir> is the name of the directory to add the delta output to"
    echo "    <envConfigCommitId> is the Commit Id retrieved from the Org being deployed to"
    echo "    <currentBranch> is the Git branch currently being deployed from"; echo ""
    echo "For example: generate-delta.sh delta-directory 38chgosnw3ss1gj85fdz origin/release/1.2.0"; echo ""
    exit 0
else
    generateDelta "$@"
fi