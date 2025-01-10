#!/bin/bash

# Author: Stuart Grieve (Slalom)

function createScratchOrg {

    devHub="$1"
    alias="$2"
    durationDays="$3"

    # Throw failure if script hits error
    set -e

    # Create scratch org
    echo "`date +"%T"`: Creating scratch org..."
    sf org create scratch --alias $alias --target-dev-hub $devHub --definition-file config/snapshot-scratch-def.json --duration-days $durationDays --wait 60 -d

    # Install dependent packages
    # Note: You may be building against other packages, for example, Marketing Cloud. Therefore, you'll need Marketing Cloud in your Scratch Org to be able to push your Metadata to it
    #       To get the Package Ids for your Org, run sf package installed list and grab the Id starting 04t
    echo "`date +"%T"`: Installing Marketing Cloud..."
    sf package install --no-prompt --package 04t6S000001IP3dQAG --target-org $alias -w 45

    # Deploy Metadata
    echo "`date +"%T"`: Deploying Metadata..."
    sf project deploy start --ignore-conflicts --ignore-warnings --source-dir force-app/main/default --wait 60 --target-org $alias

    # Deploy OmniStudio
    # Note: remove if not using OmniStudio
    echo "`date +"%T"`: Deploying OmniStudio metadata..."
    sf project deploy start --ignore-conflicts --ignore-warnings --source-dir omniStudio-metadata/ --wait 60 --target-org $alias

    # Assigning permissions to the active user
    # Note: this can speed up development activities by ensuring you have all the relevant Permission Sets you need already assigned
    echo "`date +"%T"`: Assigning permissions..."
    sf org assign permset --name OmniStudioBase --target-org $alias
    sf org assign permset --name DocGenDesigner --target-org $alias

    # Publish experience cloud
    # Note: Have an Experience Site? You'll need to publish it since it's just been deployed
    echo "`date +"%T"`: Publishing experience cloud..."
    sf community publish --name 'ExperienceSite'

    # Import data
    # Note: Have any data in .csv files to import? This could even be some test data you've defined to support dev/testing. Run the import script on as many directories as needed
    echo "`date +"%T"`: Loading data..."
    ./utilities/import-config-data.sh "$alias" "config-data/cpq"

}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 3 ]]; then
    echo ""; echo "====================================================";
    echo "Create Scratch Org"
    echo "===================================================="; echo ""
    echo "Usage: create-scratch-org.sh <devHub> <alias> <durationDays>"; echo ""
    echo "Where:"
    echo "    <devHub> is the alias or username for the Dev Hub"
    echo "    <alias> is the alias for the new scratch org"
    echo "    <durationDays> is the number of days til the scratch org expires"; echo ""
    echo 'For example: create_scratch_org.sh DevHub Jira-012 10'
    exit 0
else
    createScratchOrg "$@"
fi
