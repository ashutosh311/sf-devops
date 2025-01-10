#!/bin/bash

# Author: Stuart Grieve (Slalom)

function setEnvConfigCustomSetting {

    echo "Updating the Application Version Number and Commit Id of the Environment Configuration custom setting..."; echo ""

    # Throw failure if script hits error
    set -e

    username="$1"
    versionNumber="$2"
    commitId="$3"

    # Check parameters aren't empty
    if [[ $versionNumber != "" ]] && [[ $commitId != "" ]]; then

        # Generating anonymous apex into temporary file
        echo "EnvironmentConfiguration__c envConfigs = EnvironmentConfiguration__c.getOrgDefaults();" > set-env-config.apex
        if [[ $versionNumber != "" ]]; then echo "envConfigs.ApplicationVersion__c = 'v$versionNumber';" >> set-env-config.apex; fi
        if [[ $commitId != "" ]]; then echo "envConfigs.CommitId__c = '$commitId';" >> set-env-config.apex; fi
        echo "upsert envConfigs;" >> set-env-config.apex

        # Execute 
        sf apex run -o $username --file set-env-config.apex 

    else
        echo "Exiting set-env-config-custom-setting.sh, one or both parameters empty..."; echo ""
    fi
}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 3 ]]; then
    echo ""; echo "===============================================";
    echo "Update Environment Configuration Custom Setting"
    echo "==============================================="; echo ""
    echo "Usage: set-env-config-custom-setting.sh <username> <versionNumber> <commitId>"; echo ""
    echo "Where:"
    echo "    <username> is the login currently authenticated via the Salesforce CLI to be targeted" 
    echo "    <versionNumber> reflects the Release Number being deployed, e.g. 2.5.0"
    echo "    <commitId> is the Id of the Git Commit at the HEAD of the current branch, e.g. 38djng94hw8hg85jwioa92jaofv8eiaujx"; echo ""
    exit 0
else
    setEnvConfigCustomSetting "$@"
fi
