#!/bin/bash

# Author: Stuart Grieve (Slalom)

function exportConfigData {

    csvFile="$1"

    # Read the first line of the CSV file
    first_line=$(head -n 1 "$csvFile")

    # Check if the first line starts with a '#' (comment)
    if [[ "$first_line" != \#* ]]; then
        # No comment, build SOQL
        # Get SObject Name from file name
        sobject=${csvFile##*-}          # Strip index
        sobject="${sobject/".csv"/}"    # Strip extension

        # Get External Id from first header column
        for header in $(head -n1 $csvFile | tr , '\n')
        do
            externalId=$header
            break
        done

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
    echo "Usage: export-config-data.sh <username> <path>"; echo ""
    echo "Where:"
    echo "    <username> is the username or alias of the active SF CLI authentication"
    echo "    <path> is the CSV file or directory of CSV files to export Config Data for"; echo ""
    echo 'For example: import-config-data.sh "bitbucket.integration@abc.com" "config-data/cpq/01-Product2.csv"'
    exit 0
else
    username="$1"
    path="$2"

    # Throw failure if script hits error
    set -e

    echo "Exporting config data for $path via Bulk API ..."; echo ""

    # Determine whether path is a file, or a directory to be iterated through
    if [ -f "$path" ]; then
        # Path is a file, run export for single file
        exportConfigData $path

    elif [ -d "$path" ]; then
        # Path is a directory, get config data files from directory
        cd $path
        declare -a fileList=$(ls *.csv)

        # Run export for each file
        for file in ${fileList[@]}
        do
            echo "Processing $file..."
            exportConfigData "$file"
        done

    else
        echo "$path is neither a file nor a directory, exiting script."
        exit 1
    fi

fi