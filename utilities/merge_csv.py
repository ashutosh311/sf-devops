import csv
import sys

from pathlib import Path

if len(sys.argv) != 3:
    print("Usage: python merge_csv.py <full_csv> <delta_csv>")
    sys.exit(1)
full_csv = Path(sys.argv[1])
delta_csv = Path(sys.argv[2])

def read_csv(path):

    with path.open("r", encoding="utf-8", newline="") as f:

        return list(csv.reader(f))

 

full_rows = read_csv(full_csv)

delta_rows = read_csv(delta_csv)

 

if len(full_rows) < 2:

    raise Exception(f"Invalid full CSV format: {full_csv}")

 

# Empty delta → skip

if len(delta_rows) <= 2:

    print(f"No delta records. Skipping merge.")

    sys.exit(0)

full_comment = full_rows[0]
full_header = full_rows[1]
delta_header = delta_rows[1]

if full_header != delta_header:
    raise Exception("Header mismatch")

external_id_idx = 0

# Index full file
full_index = {}
for i in range(2, len(full_rows)):
    row = full_rows[i]
    if len(row) > external_id_idx:
        full_index[row[external_id_idx]] = i

# Merge
for row in delta_rows[2:]:
    if not row:
        continue
    key = row[external_id_idx]
    if key in full_index:
        full_rows[full_index[key]] = row
    else:
        full_rows.append(row)

# Preserve comment
full_rows[0] = full_comment

with full_csv.open("w", encoding="utf-8", newline="") as f:
    writer = csv.writer(f, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    writer.writerows(full_rows)

print(f"Merged successfully")