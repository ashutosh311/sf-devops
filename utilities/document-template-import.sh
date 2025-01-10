#!/bin/bash

# Author: Stuart Grieve (Slalom)

function importDocTemplates {

    echo "Beginning Vlocity CLI Document Template import..."; echo ""

    set -e

    username="$1"

    # Install Vlocity CLI and import Document Templates
    npm install -g vlocity
    vlocity -sfdx.username $username -job vlocity/build.yaml packDeploy --activate

}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 1 ]]; then
    echo ""; echo "=======================================================";
    echo "Import OmniStudio Document Templates via Vlocity CLI"
    echo "======================================================="; echo ""
    echo "Usage: document-template-import.sh <username>"; echo ""
    echo "Where:"
    echo "    <username> is the username of the Bitbucket Integration user in the target environment"; echo ""
    exit 0
else
    importDocTemplates "$@"
fi