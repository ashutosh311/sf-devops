!/bin/bash

# Author: Stuart Grieve (Slalom)

# ----------------------------------------
# Merge function
# ----------------------------------------

function mergeCsvByExternalId {

  fullCsv="$1"
  deltaCsv="$2"

  python3 utilities/merge_csv.py "$fullCsv" "$deltaCsv"

  if [ $? -ne 0 ]; then
    echo "CSV merge failed!"
    exit 1
  fi
}

# ----------------------------------------
# Export function
# ----------------------------------------

function exportConfigData {

  csvFile="$1"
  mode="$2"
  ticketId="$3"

  echo "----------------------------------------"
  echo "Processing file: $csvFile"

  first_line=$(head -n 1 "$csvFile")               # #query
  header_line=$(sed -n '2p' "$csvFile" | tr -d '"')

  sobject=${csvFile##*/}
  sobject="${sobject#*-}"
  sobject="${sobject/.csv/}"

  externalId=$(echo "$header_line" | cut -d',' -f1 | xargs)

  outputFile="${csvFile}.out"

  # ----------------------------------------
  # Build query
  # ----------------------------------------

  if [ "$mode" == "full" ]; then
    query="SELECT $header_line FROM $sobject \
WHERE $externalId != null \
ORDER BY $externalId"

    echo "Running FULL export..."

  elif [ "$mode" == "delta" ]; then

    query="SELECT $header_line FROM $sobject \
WHERE $externalId != null \
AND ReadyToDeploy__c = true \
AND DeploymentTicket__c = '$ticketId' \
ORDER BY $externalId"

    echo "Running DELTA export for ticket: $ticketId"
  else
    echo "Invalid mode: $mode (use 'full' or 'delta')"
    exit 1
  fi

  echo "$query"
  echo ""

  # ----------------------------------------
  # Run export
  # ----------------------------------------

  sf data query -q "$query" \
    --output-file "$outputFile" \
    --result-format csv \
    -o "$username"

  sed -i 's/\r$//' "$outputFile"

  if [ ! -f "$outputFile" ]; then
    echo "Export failed: file not created"
    exit 1
  fi

  # ----------------------------------------
  # FULL MODE 
  # ----------------------------------------

  if [ "$mode" == "full" ]; then
    {
      echo "$first_line"
      cat "$outputFile"
    } > temp_full_file
    mv temp_full_file "$csvFile"
    rm -f "$outputFile"
    sed -i 's/\r$//' "$csvFile"
    echo "FULL sync completed: $csvFile"
    echo ""
    return
  fi

  # ----------------------------------------
  # DELTA MODE → check empty
  # ----------------------------------------

  dataRowCount=$(tail -n +2 "$outputFile" | wc -l)

  if [ "$dataRowCount" -eq 0 ]; then
    echo "No records found for ticket $ticketId — skipping merge."
    rm -f "$outputFile"
    return
  fi

  # Add comment line to delta
  deltaFile="${csvFile}.delta"
  {
    echo "$first_line"
    cat "$outputFile"
  } > "$deltaFile"

  sed -i 's/\r$//' "$deltaFile"

  rm -f "$outputFile"

  # ----------------------------------------
  # Merge
  # ----------------------------------------

  echo "Merging delta into full file..."
  mergeCsvByExternalId "$csvFile" "$deltaFile"

  rm -f "$deltaFile"

  echo "Updated: $csvFile"
  sed -i 's/\r$//' "$csvFile" #Fix line ending
  echo ""

}

# ----------------------------------------
# Entry point
# ----------------------------------------

if [[ "$#" -lt 3 ]]; then
  echo ""
  echo "Usage:"
  echo "  export-config-data.sh <username> <path> <mode> [ticketId]"
  echo ""
  echo "Modes:"
  echo "  full               → full sandbox sync"
  echo "  delta <ticketId>   → PR export"
  echo ""
  exit 1
fi

username="$1"
path="$2"
mode="$3"
ticketId="$4"

set -e

echo "========================================"
echo "Mode: $mode"
echo "========================================"
echo ""

# ----------------------------------------
# File
# ----------------------------------------

if [ -f "$path" ]; then
  exportConfigData "$path" "$mode" "$ticketId"
# ----------------------------------------
# Directory
# ----------------------------------------

elif [ -d "$path" ]; then
  cd "$path"
  for file in *.csv
  do
    exportConfigData "$file" "$mode" "$ticketId"
  done
# ----------------------------------------
# Comma list
# ----------------------------------------

elif [[ "$path" == *","* ]]; then
  baseDir="config-data/cpq/"
  IFS=',' read -ra fileArray <<< "$path"
  for file in "${fileArray[@]}"
  do
    file=$(echo "$file" | xargs)
    fullPath="$baseDir/$file"
    if [ -f "$fullPath" ]; then
      exportConfigData "$fullPath" "$mode" "$ticketId"
    else
      echo "Warning: $file not found"
    fi
  done
else
  echo "Invalid path: $path"
  exit 1
fi

echo "========================================"
echo "Completed"
echo "========================================"