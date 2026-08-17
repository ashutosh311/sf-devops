"use strict";

/**
 * ARM approval-matrix validator (pure logic).
 *
 * Single source of truth for the ARM matrix validation + boundary routing
 * simulation. Consumed by:
 *   - the MCP tool `rca_validate_arm_matrix` (packages/mcp) — in-process,
 *   - the runnable CLI `devops/scripts/validate-arm-matrix.mjs` — thin wrapper.
 * Node port of the original scripts/validate_matrix.rb from the ARM skill.
 * See devops/standards/arm.md for the approval contract and data model.
 */

const ALLOWED_TYPES = ["Static", "Dynamic"];
const ALLOWED_STRATEGIES = [
  "QuoteOwnerManager",
  "ProductFamilyManager",
  "SecondLevelManager",
  "QuoteOwnerVP",
  "Queue",
  "User",
  "PublicGroup",
  "RecordField",
];
const REQUIRED = [
  "operating_unit",
  "tier",
  "threshold",
  "operator",
  "approver_type",
  "approver_strategy",
  "approver_reference",
];

function addError(errors, index, message) {
  errors.push(`row ${index + 1}: ${message}`);
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInteger(value) {
  const s = String(value).trim();
  if (!/^[+-]?\d+$/.test(s)) return null;
  return Number.parseInt(s, 10);
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Validate an ARM approval-matrix scenario document and compute boundary
 * routing simulations. Pure — never reads files, logs, or exits.
 *
 * @param {unknown} document An array of rows, or an object with a `rows` array
 *   (and optional `max_tiers`).
 * @returns {{ valid: boolean, errors: string[], warnings: string[], simulations: Record<string, unknown> }}
 * @throws {TypeError} when the document shape is structurally invalid.
 */
function validateArmMatrix(document) {
  const rows = Array.isArray(document) ? document : document?.rows;
  if (!Array.isArray(rows)) {
    throw new TypeError(
      'scenario must be an array of rows or an object with a "rows" array'
    );
  }
  const maxTiers = Array.isArray(document)
    ? 3
    : Number.parseInt(String(document?.max_tiers ?? 3), 10);

  const errors = [];
  const warnings = [];
  const seen = new Map();
  const validRows = [];

  rows.forEach((row, index) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      addError(errors, index, "row must be an object");
      return;
    }

    const missing = REQUIRED.filter((key) => !(key in row) || isBlank(row[key]));
    if (missing.length > 0) {
      addError(errors, index, `missing ${missing.join(", ")}`);
      return;
    }

    const tier = toInteger(row.tier);
    const threshold = normalizeNumber(row.threshold);

    if (!(tier !== null && tier >= 1 && tier <= maxTiers)) {
      addError(errors, index, `tier must be an integer from 1 through ${maxTiers}`);
    }
    if (!(threshold !== null && threshold >= 0 && threshold <= 100)) {
      addError(errors, index, "threshold must be numeric from 0 through 100");
    }
    if (row.operator !== ">") {
      addError(errors, index, "operator must be strict greater-than (>)");
    }
    if (!ALLOWED_TYPES.includes(row.approver_type)) {
      addError(errors, index, "approver_type must be Static or Dynamic");
    }
    if (!ALLOWED_STRATEGIES.includes(row.approver_strategy)) {
      addError(
        errors,
        index,
        `unsupported approver_strategy ${JSON.stringify(row.approver_strategy)}`
      );
    }

    if (row.approver_strategy === "Queue" && row.approver_type !== "Static") {
      warnings.push(`row ${index + 1}: a fixed queue is normally Static`);
    }

    const key = REQUIRED.map((field) => String(row[field])).join("|");
    if (seen.has(key)) {
      addError(errors, index, `duplicates row ${seen.get(key) + 1}`);
    } else {
      seen.set(key, index);
    }

    validRows.push(row);
  });

  const simulations = {};
  const byUnit = new Map();
  for (const row of validRows) {
    const unit = row.operating_unit;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit).push(row);
  }

  for (const [unit, unitRows] of byUnit) {
    const thresholds = [
      ...new Set(
        unitRows.map((row) => normalizeNumber(row.threshold)).filter((v) => v !== null)
      ),
    ].sort((a, b) => a - b);
    const discounts = [
      ...new Set([0, ...thresholds, ...thresholds.map((v) => round2(v + 0.01))]),
    ].sort((a, b) => a - b);

    simulations[unit] = discounts.map((discount) => {
      const qualifying = unitRows
        .filter((row) => {
          const threshold = normalizeNumber(row.threshold);
          return threshold !== null && row.operator === ">" && discount > threshold;
        })
        .sort((a, b) => {
          const ta = Number(a.tier) || 0;
          const tb = Number(b.tier) || 0;
          if (ta !== tb) return ta - tb;
          const tha = Number(a.threshold) || 0;
          const thb = Number(b.threshold) || 0;
          if (tha !== thb) return tha - thb;
          return String(a.approver_strategy).localeCompare(String(b.approver_strategy));
        });

      return {
        discount,
        requirements: qualifying.map((row) => ({
          tier: row.tier,
          strategy: row.approver_strategy,
          reference: row.approver_reference,
        })),
      };
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    simulations,
  };
}

module.exports = { validateArmMatrix };
