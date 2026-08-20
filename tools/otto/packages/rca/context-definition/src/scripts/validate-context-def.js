#!/usr/bin/env node
/**
 * validate-context-def.js - Validate Salesforce RCA Context Definition XML files.
 *
 * Checks:
 *   1. Well-formed XML
 *   2. Every contextAttribute in a mapping has a matching node definition
 *   3. No duplicate attribute titles within a node
 *   4. Required child elements present in contextAttributes blocks
 *   5. contextAttribute matches contextInputAttributeName in mappings
 *   6. Nested contextAttrHydrationDetails have valid objectName and queryAttribute
 *   7. Node-level structural integrity (contextTags, title, transposable, etc.)
 *
 * Usage:
 *   node validate-context-def.js <path-to-contextDefinition-meta.xml>
 *   node validate-context-def.js <path> --verbose
 *   node validate-context-def.js <path> --check-attribute <AttributeName>
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { parseXML } = require("./sf-xml-parser.js");

const USAGE = `
validate-context-def.js - Validate Salesforce RCA Context Definition XML files.

Checks:
  1. Well-formed XML
  2. Every contextAttribute in a mapping has a matching node definition
  3. No duplicate attribute titles within a node
  4. Required child elements present in contextAttributes blocks
  5. contextAttribute matches contextInputAttributeName in mappings
  6. Nested contextAttrHydrationDetails have valid objectName and queryAttribute
  7. Node-level structural integrity (contextTags, title, transposable, etc.)

Usage:
  node validate-context-def.js <path-to-contextDefinition-meta.xml>
  node validate-context-def.js <path> --verbose
  node validate-context-def.js <path> --check-attribute <AttributeName>
`.trim();

const NS = "http://soap.sforce.com/2006/04/metadata";

const REQUIRED_ATTR_CHILDREN = new Set(["dataType", "fieldType", "title"]);
const VALID_DATA_TYPES = new Set([
  "string",
  "currency",
  "number",
  "percent",
  "boolean",
  "datetime",
  "picklist",
  "reference",
  "lookup",
  "date",
  "selfreference",
]);
const VALID_FIELD_TYPES = new Set(["input", "inputoutput", "output"]);
const VALID_INTENTS = new Set([
  "hydration",
  "persistence",
  "association",
  "translation",
]);

function nsTag(tag) {
  return `{${NS}}${tag}`;
}

function getText(el, childTag) {
  const child = el.find(nsTag(childTag));
  return child && child.text ? child.text.trim() : null;
}

class ValidationResult {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.info = [];
  }

  get ok() {
    return this.errors.length === 0;
  }

  error(msg) {
    this.errors.push(msg);
  }

  warn(msg) {
    this.warnings.push(msg);
  }

  addInfo(msg) {
    this.info.push(msg);
  }

  printReport() {
    for (const msg of this.info) {
      console.log(`  INFO  ${msg}`);
    }
    for (const msg of this.warnings) {
      console.log(`  WARN  ${msg}`);
    }
    for (const msg of this.errors) {
      console.log(`  ERROR ${msg}`);
    }
    console.log();
    if (this.ok) {
      console.log(
        `PASS  ${this.warnings.length} warning(s), 0 error(s)`
      );
    } else {
      console.log(
        `FAIL  ${this.errors.length} error(s), ${this.warnings.length} warning(s)`
      );
    }
  }
}

function collectNodeAttributes(root) {
  const nodeAttrs = {};
  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    for (const node of version.iter(nsTag("contextNodes"))) {
      const nodeTitle = getText(node, "title");
      if (!nodeTitle) continue;
      if (!nodeAttrs[nodeTitle]) nodeAttrs[nodeTitle] = new Set();
      for (const attr of node.findall(nsTag("contextAttributes"))) {
        const attrTitle = getText(attr, "title");
        if (attrTitle) nodeAttrs[nodeTitle].add(attrTitle);
      }
    }
  }
  return nodeAttrs;
}

function collectMappingAttributes(root) {
  const results = [];
  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    for (const mapping of version.findall(nsTag("contextMappings"))) {
      const mappingTitle = getText(mapping, "title") || "(unnamed)";
      for (const nodeMap of mapping.findall(nsTag("contextNodeMappings"))) {
        const nodeName = getText(nodeMap, "contextNode") || "(unknown)";
        for (const attrMap of nodeMap.findall(
          nsTag("contextAttributeMappings")
        )) {
          const attrName = getText(attrMap, "contextAttribute");
          if (attrName) {
            results.push([mappingTitle, nodeName, attrName]);
          }
        }
      }
    }
  }
  return results;
}

function validateXml(filepath) {
  const result = new ValidationResult();
  try {
    const content = fs.readFileSync(filepath, "utf8");
    const root = parseXML(content);
    result.addInfo(`XML well-formed: ${path.basename(filepath)}`);
    return [root, result];
  } catch (e) {
    result.error(`XML parse error: ${e.message}`);
    return [null, result];
  }
}

function validateNodeAttributes(root, result) {
  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    for (const node of version.iter(nsTag("contextNodes"))) {
      const nodeTitle = getText(node, "title") || "(unknown)";
      const seenTitles = {};

      for (const attr of node.findall(nsTag("contextAttributes"))) {
        const attrTitle = getText(attr, "title");

        for (const req of REQUIRED_ATTR_CHILDREN) {
          if (getText(attr, req) === null) {
            result.error(
              `Node '${nodeTitle}': attribute missing <${req}> (near title='${attrTitle}')`
            );
          }
        }

        if (!attrTitle) {
          result.error(
            `Node '${nodeTitle}': <contextAttributes> missing <title>`
          );
          continue;
        }

        seenTitles[attrTitle] = (seenTitles[attrTitle] || 0) + 1;
        if (seenTitles[attrTitle] > 1) {
          result.error(
            `Node '${nodeTitle}': duplicate attribute title '${attrTitle}'`
          );
        }

        const dt = getText(attr, "dataType");
        if (dt && !VALID_DATA_TYPES.has(dt)) {
          result.warn(
            `Node '${nodeTitle}', attr '${attrTitle}': unknown dataType '${dt}'`
          );
        }

        const ft = getText(attr, "fieldType");
        if (ft && !VALID_FIELD_TYPES.has(ft)) {
          result.warn(
            `Node '${nodeTitle}', attr '${attrTitle}': unknown fieldType '${ft}'`
          );
        }

        const tags = attr.findall(nsTag("contextTags"));
        if (tags.length === 0) {
          result.warn(
            `Node '${nodeTitle}', attr '${attrTitle}': missing <contextTags>`
          );
        } else {
          for (const tag of tags) {
            const tagTitle = getText(tag, "title");
            if (!tagTitle) {
              result.warn(
                `Node '${nodeTitle}', attr '${attrTitle}': <contextTags> missing <title>`
              );
            }
          }
        }
      }
    }
  }
}

function validateMappingConsistency(root, result) {
  const nodeAttrs = collectNodeAttributes(root);
  const mappingAttrs = collectMappingAttributes(root);

  for (const [mappingTitle, nodeName, attrName] of mappingAttrs) {
    if (!(nodeName in nodeAttrs)) {
      continue;
    }
    if (!nodeAttrs[nodeName].has(attrName)) {
      result.error(
        `Mapping '${mappingTitle}', node '${nodeName}': ` +
          `attribute '${attrName}' not found in node definition`
      );
    }
  }
}

function validateMappingAttributes(root, result) {
  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    for (const mapping of version.findall(nsTag("contextMappings"))) {
      const mappingTitle = getText(mapping, "title") || "(unnamed)";

      for (const intentEl of mapping.findall(
        nsTag("contextMappingIntents")
      )) {
        const intent = getText(intentEl, "mappingIntent");
        if (intent && !VALID_INTENTS.has(intent)) {
          result.warn(
            `Mapping '${mappingTitle}': unknown intent '${intent}'`
          );
        }
      }

      for (const nodeMap of mapping.findall(nsTag("contextNodeMappings"))) {
        const nodeName = getText(nodeMap, "contextNode") || "(unknown)";

        for (const attrMap of nodeMap.findall(
          nsTag("contextAttributeMappings")
        )) {
          const ctxAttr = getText(attrMap, "contextAttribute");
          const ctxInput = getText(attrMap, "contextInputAttributeName");

          if (ctxAttr && ctxInput && ctxAttr !== ctxInput) {
            result.warn(
              `Mapping '${mappingTitle}', node '${nodeName}': ` +
                `contextAttribute '${ctxAttr}' != contextInputAttributeName '${ctxInput}'`
            );
          }

          validateHydrationDetails(
            attrMap,
            mappingTitle,
            nodeName,
            ctxAttr || "(unknown)",
            result,
            0
          );
        }
      }
    }
  }
}

function validateHydrationDetails(
  el,
  mappingTitle,
  nodeName,
  attrName,
  result,
  depth
) {
  for (const hyd of el.findall(nsTag("contextAttrHydrationDetails"))) {
    const objName = getText(hyd, "objectName");
    const queryAttr = getText(hyd, "queryAttribute");

    if (!objName) {
      result.error(
        `Mapping '${mappingTitle}', node '${nodeName}', attr '${attrName}': ` +
          `<contextAttrHydrationDetails> missing <objectName> (depth=${depth})`
      );
    }
    if (!queryAttr) {
      result.error(
        `Mapping '${mappingTitle}', node '${nodeName}', attr '${attrName}': ` +
          `<contextAttrHydrationDetails> missing <queryAttribute> (depth=${depth})`
      );
    }

    validateHydrationDetails(
      hyd,
      mappingTitle,
      nodeName,
      attrName,
      result,
      depth + 1
    );
  }
}

function validateVersionMetadata(root, result) {
  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    const isActive = getText(version, "isActive");
    const versionNum = getText(version, "versionNumber");
    const startDate = getText(version, "startDate");

    if (isActive !== "true") {
      result.warn(
        `Context version is not active (isActive=${isActive})`
      );
    }
    if (versionNum) {
      result.addInfo(`Version: ${versionNum}, startDate: ${startDate}`);
    } else {
      result.warn("Missing <versionNumber>");
    }
  }
}

function checkAttribute(root, attrName, result) {
  result.addInfo(`--- Checking attribute: ${attrName} ---`);

  const foundInNodes = [];
  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    for (const node of version.iter(nsTag("contextNodes"))) {
      const nodeTitle = getText(node, "title") || "(unknown)";
      for (const attr of node.findall(nsTag("contextAttributes"))) {
        if (getText(attr, "title") === attrName) {
          const dt = getText(attr, "dataType") || "?";
          const ft = getText(attr, "fieldType") || "?";
          foundInNodes.push(
            `Node '${nodeTitle}' (dataType=${dt}, fieldType=${ft})`
          );
        }
      }
    }
  }

  if (foundInNodes.length > 0) {
    for (const loc of foundInNodes) {
      result.addInfo(`  Node definition: ${loc}`);
    }
  } else {
    result.warn(
      `  Attribute '${attrName}' NOT found in any node definition`
    );
  }

  const foundInMappings = [];
  const mappingAttrs = collectMappingAttributes(root);
  for (const [mappingTitle, nodeName, mappedAttr] of mappingAttrs) {
    if (mappedAttr === attrName) {
      foundInMappings.push(
        `Mapping '${mappingTitle}', node '${nodeName}'`
      );
    }
  }

  if (foundInMappings.length > 0) {
    for (const loc of foundInMappings) {
      result.addInfo(`  Mapping reference: ${loc}`);
    }
  } else {
    result.warn(
      `  Attribute '${attrName}' NOT found in any mapping`
    );
  }
}

function countStats(root, result) {
  let nodeCount = 0;
  let attrCount = 0;
  let mappingCount = 0;
  let mappingAttrCount = 0;

  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    for (const node of version.iter(nsTag("contextNodes"))) {
      nodeCount++;
      attrCount += node.findall(nsTag("contextAttributes")).length;
    }
    for (const mapping of version.findall(nsTag("contextMappings"))) {
      mappingCount++;
      for (const nodeMap of mapping.findall(nsTag("contextNodeMappings"))) {
        mappingAttrCount += nodeMap.findall(
          nsTag("contextAttributeMappings")
        ).length;
      }
    }
  }

  result.addInfo(`Nodes: ${nodeCount}, Node attributes: ${attrCount}`);
  result.addInfo(
    `Mappings: ${mappingCount}, Mapped attributes: ${mappingAttrCount}`
  );
}

function main() {
  if (process.argv.length < 3) {
    console.log(USAGE);
    process.exit(1);
  }

  const filepath = process.argv[2];
  if (!fs.existsSync(filepath)) {
    console.log(`File not found: ${filepath}`);
    process.exit(1);
  }

  const verbose = process.argv.includes("--verbose");
  let checkAttr = null;
  const checkIdx = process.argv.indexOf("--check-attribute");
  if (checkIdx !== -1 && checkIdx + 1 < process.argv.length) {
    checkAttr = process.argv[checkIdx + 1];
  }

  console.log(`Validating: ${filepath}`);
  console.log("=".repeat(60));

  const [root, result] = validateXml(filepath);
  if (root === null) {
    result.printReport();
    process.exit(1);
  }

  countStats(root, result);
  validateVersionMetadata(root, result);
  validateNodeAttributes(root, result);
  validateMappingAttributes(root, result);
  validateMappingConsistency(root, result);

  if (checkAttr) {
    checkAttribute(root, checkAttr, result);
  }

  if (verbose) {
    const nodeAttrs = collectNodeAttributes(root);
    console.log("\nNode definitions:");
    for (const nodeTitle of Object.keys(nodeAttrs).sort()) {
      console.log(`  ${nodeTitle}: ${nodeAttrs[nodeTitle].size} attributes`);
    }
  }

  result.printReport();
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { main };
