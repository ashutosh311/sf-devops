#!/bin/bash

# Author: Stuart Grieve (Slalom)

function authenticateWithOrg {

    username="$1"
    consumerKey="$2"
    url="$3"
    encryptionKey="$4"
    encryptionIv="$5"
    certPath="$6"

    echo "Authenticating to "$username"..."; echo ""

    # Throw failure if script hits error
    set -e

    # Decrypt certificate stored in repository with key/iv secrets
    mkdir -p certificates
    openssl enc -nosalt -aes-256-cbc -d -in $certPath -out certificates/server.key -base64 -K $encryptionKey -iv $encryptionIv

    # Login to target environment
    sf login org jwt --client-id $consumerKey --username $username -f certificates/server.key --instance-url $url

    # Deleting decrypted certificate now authenticated
    rm certificates/server.key
    
    echo ""

}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 6 ]]; then
    echo ""; echo "===============================================";
    echo "Authenticate with a Salesforce Environment"
    echo "==============================================="; echo ""
    echo "Usage: sf-authenticate.sh <username> <consumerKey> <url> <encryptionKey> <encryptionIv> <certPath>"; echo ""
    echo "Where:"
    echo "    <username> is the username of the Bitbucket Integration user in the target environment" 
    echo "    <consumerKey> is the Bitbucket Integration Connected App's Consumer Key. This should be stored in Bitbucket as a secret variable."
    echo "    <url> is the URL of the target environment.";
    echo "    <encryptionKey> is the Key value returned when encrypting the JWT certificate. This should be stored in Bitbucket as a secret variable.";
    echo "    <encryptionIv> is the IV value returned when encrypting the JWT certificate. This should be stored in Bitbucket as a secret variable.";
    echo "    <certPath> the path where your server.key.enc is stored in the repo."; echo ""
    echo "For example: sf-authenticate.sh bitbucket.integration@abc.co.uk iuh98327ewfdiuhsd872eqwosijasdkuhf87 https://abc.my.salesforce.com 98euf98udijdijnusdiaun duw83hruc9sjs8cvhjen3is certificates/server.key.enc"; echo ""
    exit 0
else
    authenticateWithOrg "$@"
fi