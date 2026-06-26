#!/bin/bash

# Author: Stuart Grieve (Slalom)

function createBypassReport {

    declare workspace="$1"

    echo "Creating traceability report to show where the project is bypassing Code Quality scanning..."; echo ""

    # Throw failure if script hits error
    set -e

    # Declare vars
    declare -a bypassList=()
    bypassReasonOnBypassMissing=false

    scanFilesForEngineBypass "ESLint" "*.js" "eslint-disable"
    scanFilesForEngineBypass "PMD" "*.cls" "@SuppressWarnings"

    # Count any found bypasses, build report if any found
    bypassCount=${#bypassList[@]}
    if [ $bypassCount -gt 0 ]; then

        echo Found $bypassCount bypasses. Writing results to csv...; echo ""

        # Sorting list
        IFS=$'\n' sortedList=($(sort <<<"${bypassList[*]}"))

        echo File,Line Number,Bypass Reason,Rule Engine,Author,Date > bypass-report.csv
        for ((i = 0; i < ${#sortedList[@]}; i++)); do
            echo "${sortedList[$i]}" >> bypass-report.csv
        done

    else
        echo Found no code analyzer bypasses. No report generated.; echo ""

    fi

    if [ $bypassReasonOnBypassMissing == true ]; then
        # Add any handling of a bypass without a comment here
        # e.g. are you running this on a feature validation and want to fail the pipe?
        echo One or more bypasses found without a bypass reason code comment before. Bypasses must use the \"// Bypass reason:\" convention on the line before...; echo ""
    fi

}

function scanFilesForEngineBypass {

    engine="$1"
    fileExt="$2"
    bypassStr="$3"

    # Get all files with the associated file ext
    fileList=$(find "$workspace" -type f -name "$fileExt")
    for file in ${fileList[@]}; do
        
        # Scan file for string which denotes scanner bypass and get line number(s)
        lineNumbers=$(grep -wn "$bypassStr" "$file" | awk -F: '{print $1}')

        # Loop over identified file numbers
        for num in ${lineNumbers[@]}; do

            # Run git blame to find author
            blameResult=$(git blame -e -L "$num,$num" "$file" 2>/dev/null)
            author=$(sed 's/.*<//; s/>.*//' <<< "$blameResult")
            blameResultArray=($blameResult)
            date="${blameResultArray[2]}"

            if [ $num -gt 1 ]; then
                # Bypass not on first line of file, get line number of previous line to extract comment
                previousLineNum=$((num - 1))
                previousLine=$(awk "NR==$previousLineNum" "$file")
                if [[ $previousLine == *'// Bypass reason:'* ]] || [[ $previousLine == *'/* Bypass Reason:'* ]]; then
                    # Previous line contains comment, print as reason (trim any "//" "/*" "*/" and whitespace to just get text)
                    removeCommentSyntax1=${previousLine/\/\//}
                    removeCommentSyntax2=${removeCommentSyntax1/\/*/}
                    removeCommentSyntax3=${removeCommentSyntax2/*\//}
                    bypassReason="$(printf '%s' "${removeCommentSyntax3}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
                else
                    # No reason detected
                    bypassReason="No bypass reason comment detected before bypass is used."
                    bypassReasonOnBypassMissing=true
                fi
            else
                # Bypass on first line of file, therefore no reason comment
                bypassReason="No bypass reason comment detected before bypass is used."
                bypassReasonOnBypassMissing=true
            fi 

            # Add bypass to array
            bypassList+=("$file,$num,$bypassReason,$engine,$author,$date")

            
        done
    
    done

}

if [[ "$1" == "-h" || "$1" == "--help" || "$#" -ne 1 ]]; then
    echo ""; echo "====================================================";
    echo "Create Analyzer Bypass Report"
    echo "===================================================="; echo ""
    echo "Usage: create-anaylzer-bypass-report <workspace>"; echo ""
    echo "Where:"
    echo "    <workspace> is the path of the Salesforce project"
    echo 'For example: create-anaylzer-bypass-report.sh force-app'
    exit 0
else
    createBypassReport "$@"
fi
