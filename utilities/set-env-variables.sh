#!/bin/bash

# Author: Stuart Grieve (Slalom)

function setEnvVariables {

    env=$Environment
    envName="$1"

    echo "Setting environment variables to support authentication and sfdx-project.json replacements..."; echo ""

    # Throw failure if script hits error
    set -e

    # Set env vars based on environment name
    export SF_DECRYPT_KEY=$SF_DECRYPT_KEY_SANDBOX
    export SF_DECRYPT_IV=$SF_DECRYPT_IV_SANDBOX
    export SF_SERVER_KEY="certificates/server.key.enc"
    if [ $envName == "DEV" ]; then
        export SF_USERNAME=$SF_DEV_USERNAME
        export SF_CONSUMER_KEY=$SF_DEV_CONSUMER_KEY
        export SF_URL=$SF_DEV_URL
        export SFDX_REPLACEMENT_NETWORK_USER="dev_user@abc.co.uk.dev"
    elif [ $envName == "QA" ]; then
        export SF_USERNAME=$SF_QA_USERNAME
        export SF_CONSUMER_KEY=$SF_QA_CONSUMER_KEY
        export SF_URL=$SF_QA_URL
        export SFDX_REPLACEMENT_NETWORK_USER="qa_user@abc.co.uk.qa"
    elif [ $envName == "SIT" ]; then
        export SF_USERNAME=$SF_SIT_USERNAME
        export SF_CONSUMER_KEY=$SF_SIT_CONSUMER_KEY
        export SF_URL=$SF_SIT_URL
        export SFDX_REPLACEMENT_NETWORK_USER="sit_user@abc.co.uk.sit"
    elif [ $envName == "UAT" ]; then
        export SF_USERNAME=$SF_UAT_USERNAME
        export SF_CONSUMER_KEY=$SF_UAT_CONSUMER_KEY
        export SF_URL=$SF_UAT_URL
        export SFDX_REPLACEMENT_NETWORK_USER="uat_user@abc.co.uk.uat"
    elif [ $envName == "HOTFIX" ]; then
        export SF_USERNAME=$SF_HOTFIX_USERNAME
        export SF_CONSUMER_KEY=$SF_HOTFIX_CONSUMER_KEY
        export SF_URL=$SF_HOTFIX_URL
        export SFDX_REPLACEMENT_NETWORK_USER="hotfix_user@abc.co.uk.hotfix"
    elif [ $envName == "Production" ]; then
        export SF_USERNAME=$SF_PROD_USERNAME
        export SF_CONSUMER_KEY=$SF_PROD_CONSUMER_KEY
        export SF_URL=$SF_PROD_URL
        export SF_DECRYPT_KEY=$SF_DECRYPT_KEY_PRODUCTION
        export SF_DECRYPT_IV=$SF_DECRYPT_IV_PRODUCTION
        export SF_SERVER_KEY="certificates/productionServer.key.enc"
        export SFDX_REPLACEMENT_NETWORK_USER="production_user@abc.co.uk"
    else 
        echo "Provided envName parameter not recognised. Exiting pipeline..."; exit 1
    fi
    echo "Environment variables successfully set for "$envName"..."; echo ""

}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 1 ]]; then
    echo ""; echo "===========================================================";
    echo "Set Environment Variables for sfdx-project.json replacement"
    echo "==========================================================="; echo ""
    echo "Usage: set-env-variables.sh <envName>"; echo ""
    echo "Where:"
    echo "    <envName> is an Environment name which has been preconfigured with replacement variables"; echo ""
    echo "For example: set-env-variables.sh UAT"
    exit 0
else
    setEnvVariables "$@"
fi