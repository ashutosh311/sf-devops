#!/usr/bin/env python3

import os
import sys
import re
from pathlib import Path

def listFiles(folder):
    for root, folders, files in os.walk(folder):
        for filename in folders + files:
            yield os.path.join(root, filename)

test_file_names = []
classes_dir = sys.argv[1]

# check if any apex classes and add Test classes
for filename in listFiles(classes_dir):
    file_content = ''
    if not os.path.isdir(filename):
        with open(filename, 'r') as f:
            file_content = f.read().lower()

        if filename.endswith('-meta.xml'):
            pass
        elif '@istest' in file_content:
            test_file_names.append(Path(filename).stem)
        elif 'public interface' in file_content:
            pass
        else:
            test_file_names.append(Path(filename).stem + 'Test')

# convert list to unique
list_set = set(test_file_names)
# convert the set to the list
unique_list = (list(list_set))

print(','.join(sorted(unique_list)))