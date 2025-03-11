#!/bin/bash

# Author: Stuart Grieve (Slalom)

function importConfigData {

    username="$1"
    dataDirectory="$2"

    # If directory is for FS Work Types, use SFDMU
    if [[ "$dataDirectory" == *"field-service/work-types"* ]]; then

        echo "Upserting config data via SFDX Data Move Utility..."; echo ""

        # Invoke SFDMU
        sf sfdmu run --sourceusername csvfile --targetusername $username --path $dataDirectory

        # Output results files for debugging errors
        declare -a resultFiles=$(ls $dataDirectory/target)
        for file in ${resultFiles[@]}
        do
            echo "$file results: "; echo ""
            cat $dataDirectory/target/$file
        done

    # Otherwise use SF CLI data commands
    else

        echo `date +"%T"` "Upserting config data via Bulk API..."; echo ""

        # Get config data files from directory
        cd $dataDirectory
        declare -a fileList=$(ls *.csv)

        # Setup vars for error handling
        declare -a failedFileList=()
        declare -a errorList=()
        success=true

        # Loop through files in data directory
        for file in ${fileList[@]}
        do
            echo Processing $file...

            # Read the first line of the CSV file
            first_line=$(head -n 1 "$file")

            # Check if the first line starts with a '#' (comment)
            if [[ "$first_line" == \#* ]]; then
                # Remove the first line
                tail -n +2 "$file" > temp_file
                mv temp_file "$file"
            fi

            # Check if the second row is empty.
            second_row=$(sed -n '2p' "$csv_file")
            if [ -z "$second_row" ]; then
                echo "No data found in file. Skipping $file..."
            else
                # Get SObject Name from file name
                sobject=${file#*-}              # Strip index
                sobject="${sobject/".csv"/}"    # Strip extension

                # Get External Id from first header column
                for header in $(head -n1 $file | tr , '\n')
                do
                    externalId=$header
                    break
                done   

                # Upsert records
                exit 0
                sf data upsert bulk --sobject $sobject --file $file --external-id $externalId --target-org $username --wait 15 --json > bulk-output.json
            
                # Get status code from output (since non-zeros don't throw overall failure)
                status=$(jq '.status' bulk-output.json)
                if [ "$status" != "0" ]; then
                    # If object threw failure, add object name to list for logs and set overall success as false
                    failedFileList+=($file)
                    success=false

                    # Iterate through failed results to get errors messages
                    count=$(jq -r '.result.records.failedResults | length' bulk-output.json)
                    index=0
                    while [ $index -lt $count ]
                    do
                        record=$(jq '.result.records.failedResults['$index'].'$externalId bulk-output.json)
                        error=$(jq '.result.records.failedResults['$index'].sf__Error' bulk-output.json)
                        errorList+=("File: $file | Records External Id: $record | Failure: $error")
                        let "index=$index+1"
                    done
                fi
            fi

            # If the first line of file started with a comment, add it back into the file
            if [[ "$first_line" == \#* ]]; then
                { echo "$first_line"; cat "$file"; } > temp_file
                mv temp_file "$file"
            fi

        done

        echo ""
        if [ $success == false ]; then
            # Atleast one file failed, output failures to log and fail pipeline
            echo `date +"%T"` "Upsert failed on files: ${failedFileList[*]}"; echo ""
            echo Error messages:
            for ((i = 0; i < ${#errorList[@]}; i++))
            do
                echo "${errorList[$i]}"
            done
            exit 1
        else
            echo  `date +"%T"` "Upsert job completed successfully."; echo ""
        fi

    fi

}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 2 ]]; then
    echo ""; echo "====================================================";
    echo "Import Configuration Data"
    echo "===================================================="; echo ""
    echo "Usage: import-config-data.sh <username> <dataDirectory>"; echo ""
    echo "Where:"
    echo "    <username> is the username or alias of the active SF CLI authentication"
    echo "    <dataDirectory> is the path to the list of CSV files to import"; echo ""
    echo 'For example: import-config-data.sh "bitbucket.integration@abc.com" "config-data/cpq"'
    exit 0
else
    importConfigData "$@"
fi
