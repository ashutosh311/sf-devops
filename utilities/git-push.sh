# commitSfdxProjectJson: &commitSfdxProjectJson git remote set-url origin ${BITBUCKET_GIT_SSH_ORIGIN}; git pull; git add sfdx-project.json; git commit -m "[skip ci] Automated commit of sfdx-project.json for $BITBUCKET_BRANCH package creation"; git push

#!/bin/bash

# Author: Stuart Grieve (Slalom)

function gitPush {

    gitUrl="$1"
    commitMsg="$2"

    # Throw failure if script hits error
    set -e

    echo "Pushing changes to Git branch ..."; echo ""

    # Set URL since pipeline runs in detached state
    git remote set-url origin "$gitUrl"
    git pull

    # Stage and commit all changes
    git add .
    git commit -m "$commitMsg"
    git push

}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 2 ]]; then
    echo ""; echo "====================================================";
    echo "Push Changes to Git Branch"
    echo "===================================================="; echo ""
    echo "Usage: git-push.sh <gitUrl> <commitMsg>"; echo ""
    echo "Where:"
    echo "    <gitUrl> is the Git Remote URL"
    echo "    <commitMsg> is the message to include in the commit"; echo ""
    echo 'For example: git-push.sh "$BITBUCKET_GIT_SSH_ORIGIN" "Pushing code quality report to repository"'
    exit 0
else
    gitPush "$@"
fi