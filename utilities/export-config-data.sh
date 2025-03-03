#!/bin/bash

# Author: Stuart Grieve (Slalom)

function exportConfigData {

    username="$1"
    csvFile="$2"

    echo "Exporting config data for $csvFile via Bulk API ..."; echo ""

    # Throw failure if script hits error
    set -e

    # Read the first line of the CSV file
    first_line=$(head -n 1 "$csvFile")

    # Check if the first line starts with a '#' (comment)
    if [[ "$first_line" != \#* ]]; then
        # No comment, build SOQL
        # Get SObject Name from file name
        sobject=${csvFile##*-}          # Strip index
        sobject="${sobject/".csv"/}"    # Strip extension
        echo $sobject

        # Get External Id from first header column
        for header in $(head -n1 $csvFile | tr , '\n')
        do
            externalId=$header
            break
        done
        echo $externalId

        # Build query
        query="SELECT $first_line FROM $sobject ORDER BY $externalId"
        echo "CSV file doesn't start with a comment containing a SOQL statement, built query: $query"
        sf data query -q "$query" --output-file $csvFile --result-format csv -o $username
        echo "$csvFile updated successfully."; echo ""

    else
        # Execute query from SOQL in comment
        query="${first_line/##/}"
        echo "SOQL statement retrieved from comment in CSV file: $query"
        sf data query -q "$query" --output-file $csvFile --result-format csv -o $username

        # Inject comment with SOQL back into first row of output
        { echo "$first_line"; cat "$csvFile"; } > temp_file
        mv temp_file "$csvFile"
        echo "$csvFile updated successfully."; echo ""
    fi

}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 2 ]]; then
    echo ""; echo "====================================================";
    echo "Export Configuration Data"
    echo "===================================================="; echo ""
    echo "Usage: export-config-data.sh <username> <csvFile>"; echo ""
    echo "Where:"
    echo "    <username> is the username or alias of the active SF CLI authentication"
    echo "    <csvFile> is the path to the CSV file to export Config Data for"; echo ""
    echo 'For example: import-config-data.sh "bitbucket.integration@abc.com" "config-data/cpq/01-Product2.csv"'
    exit 0
else
    exportConfigData "$@"
fi