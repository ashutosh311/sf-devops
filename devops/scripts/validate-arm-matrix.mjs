#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * ARM approval-matrix validator — runnable CLI.
 *
 * Thin wrapper over the single-source validator in the Otto tool
 * (`tools/otto/packages/rca/arm-matrix`), which is also exposed as the
 * MCP tool `rca_validate_arm_matrix`. Keeping one implementation avoids the
 * dual-copy drift called out in the migration design doc.
 *
 * Validates a client approval-matrix scenario and prints boundary routing
 * simulations. Exits non-zero when any error is found.
 *
 * Usage:
 *   node devops/scripts/validate-arm-matrix.mjs path/to/scenario.json
 *
 * See devops/standards/arm.md for the approval contract and data model.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** @type {{ validateArmMatrix: (document: unknown) => { valid: boolean, errors: string[], warnings: string[], simulations: Record<string, unknown> } }} */
const { validateArmMatrix } = require(
  '../../tools/otto/packages/rca/arm-matrix/src/index.js'
);

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node devops/scripts/validate-arm-matrix.mjs path/to/scenario.json');
    process.exit(2);
  }

  let document;
  try {
    document = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`error: could not read or parse ${path}: ${err.message}`);
    process.exit(2);
  }

  let result;
  try {
    result = validateArmMatrix(document);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}

const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (invokedDirectly) {
  main();
}

export { validateArmMatrix };
