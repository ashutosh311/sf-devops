#!/bin/bash

# Author: Stuart Grieve (Slalom)

function deploy {

    deployType="$1"
    username="$2"
    runTests="$3"
    deployDir="$4"
    releaseBranch="$5"
    environmentName="$6"

    echo "Starting sf metadata validate/deploy..."; echo ""

    # Throw failure if script hits error
    set -e

    # Source member polling not needed when running deployment via CI/CD, can lead to slower deploys
    export SF_DISABLE_SOURCE_MEMBER_POLLING=true

    # Set test run sf cli parameter based on runTest selection
    if [[ "$environmentName" =~ "PRODUCTION" || "$runTests" == "true" ]]; then
        testParameter='--test-level RunLocalTests'
    elif [ "$runTests" == "false" ]; then
        testParameter='--test-level NoTestRun'
    elif [ "$runTests" == "delta" ]; then
        # Get test class names from project
        testFileNames=$(python3 utilities/get-test-class-list.py $deployDir/main/default/classes | tr ',' ' ')
        if [ "$testFileNames" == "" ]; then
            echo "Get delta test classes found no relevant tests. Using NoTestRun..."; echo ""
            testParameter='--test-level NoTestRun'
        else
            echo "Test files to run: " $testFileNames; echo ""
            mkdir -p test-results
            testParameter='--test-level RunSpecifiedTests --tests '$testFileNames' "Test With Space" --junit --results-dir ./test-results'
        fi
    elif [ "$runTests" == "" ]; then
        echo "No runTests parameter provided. Skipping..."; echo ""
    else
        echo "Unrecognised option for parameter: runTests"; echo ""
    fi

    # Determine whether we are running a validation or deployment
    if [ "$deployType" == "validate" ]; then
        # Validation only, run local tests in Org
        echo "Validating Salesforce Metadata..."; echo ""
        sf project deploy start --dry-run -c -g -d $deployDir/main/default $testParameter -o $username -w 110
    elif [ "$deployType" == "deploy" ]; then
        # Deploy Salesforce metadata
        echo "Deploying Salesforce Metadata..."; echo ""
        sf project deploy start -c -g -d $deployDir/main/default $testParameter -o $username -w 110 --pre-destructive-changes manifests/destructiveChangesPre.xml --post-destructive-changes manifests/destructiveChangesPost.xml
    else
        echo "DeploymentType parameter value not recognised..."; echo ""
    fi

    # For deploys, execute automated post deploy steps (skip for validations)
    if [[ "$deployType" == "deploy" ]]; then
        # Update Environment Config custom setting in Org
        echo "Updating Environment Config custom setting in Org..."; echo ""
        commitHash=$(git rev-parse HEAD)
        appVersion=${releaseBranch#*/}
        utilities/set-env-config-custom-setting.sh "$appVersion" "$commitHash"

        # Tag commits with deployments, N/A for QA deployments as no appVersion will be provided
        if [ "$appVersion" == "" ]; then
            echo "No application version number provided. Skipping commit tags..."; echo ""
        else
            echo "Tagging commits with deployments..."; echo ""
            git pull --tags -f
            git tag -fa $appVersion-$environmentName -m "[skip ci] Automated commit git tagging for $appVersion-$environmentName"
            git push -f origin $appVersion-$environmentName
        fi

    fi

    # Logout
    sf logout org --target-org $username --no-prompt

}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 6 ]]; then
    echo ""; echo "====================================================";
    echo "Execute a Metadata Deployment Or Validation"
    echo "===================================================="; echo ""
    echo "Usage: sf-deploy.sh <deployType> <username> <runTests> <deployDir> <appVersion> <environmentName>"; echo ""
    echo "Where:"
    echo "    <deployType> is either 'deploy' or 'validate'"
    echo "    <username> is the username or alias of the active SF CLI authentication"
    echo "    <runTests> is either 'true' or 'false'"
    echo "    <deployDir> is the name of the sfdx project folder, default would be 'force-app'"
    echo "    <appVersion> is the Release Number associated to the deployment"
    echo "    <environmentName> is the Environment/Sandbox name"; echo ""
    echo 'For example: sf-deploy.sh "deploy" "bitbucket.integration@abc.com" "true" "force-app" "3.1.0" "SIT"'
    exit 0
else
    deploy "$@"
fi
