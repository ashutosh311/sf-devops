#!/bin/bash

# Author: Stuart Grieve (Slalom)

function getEnvConfigCustomSetting {

    echo "Getting last deployed Commit Ids from Environment Configuration custom setting..."; echo ""

    # Throw failure if script hits error
    set -e

    username="$1"

    # Querying Environment Configuration
    sf data query -q "SELECT Id, CommitId__c FROM EnvironmentConfiguration__c LIMIT 1" --target-org $username --json  | tee environmentConfigurationExport.json

    # Use Jq to retrieve commit ids
    statusCode=$(jq '.status' environmentConfigurationExport.json);
    if [[ $statusCode != 0 ]]; then 
        echo "Unable to retrieve Environment Configuration data from org. Exporting null values for Commit Id..."; 
        echo "##vso[task.setvariable variable=ENV_COMMIT_ID;]"
    else 
        commitId=$(jq '.result.records[0].CommitId__c' environmentConfigurationExport.json | tr -d \");

        # Store as env var
        if [[ $commitId == "null" ]]; then echo "##vso[task.setvariable variable=ENV_COMMIT_ID;]"; else echo "##vso[task.setvariable variable=ENV_COMMIT_ID;]$commitId"; fi
    fi

}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 1 ]]; then
    echo ""; echo "===============================================";
    echo "Get Environment Configuration Custom Setting"
    echo "==============================================="; echo ""
    echo "Usage: get-env-config-custom-setting.sh <userName>"; echo ""
    echo "Where:"
    echo "    <username> is the login currently authenticated via the Salesforce CLI to be targeted"; echo ""
    exit 0
else
    getEnvConfigCustomSetting "$@"
fi