#!/usr/bin/env node
/**
 * discover-context-def.js - Map the structure of an RCA Context Definition XML file.
 *
 * Generates a structural index for agent-driven editing of context definitions.
 *
 * Usage:
 *   node discover-context-def.js <path>                 # Compact summary
 *   node discover-context-def.js <path> --node <name>   # Full detail for one node
 *   node discover-context-def.js <path> --all            # Full holistic view
 *   node discover-context-def.js <path> --json           # Full data as JSON
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { parseXML } = require("./sf-xml-parser.js");

const USAGE = `
discover-context-def.js - Map the structure of an RCA Context Definition XML file.

Usage:
  node discover-context-def.js <path>                 # Compact summary
  node discover-context-def.js <path> --node <name>   # Full detail for one node
  node discover-context-def.js <path> --all            # Full holistic view
  node discover-context-def.js <path> --json           # Full data as JSON
`.trim();

const NS = "http://soap.sforce.com/2006/04/metadata";

function nsTag(tag) {
  return `{${NS}}${tag}`;
}

function getText(el, childTag) {
  const child = el.find(nsTag(childTag));
  return child && child.text ? child.text.trim() : null;
}

// ---------------------------------------------------------------------------
// Line-range helpers
// ---------------------------------------------------------------------------

function getMappingLineRange(sourceLines, titleValue) {
  let start = null;
  const searchPattern = `<title>${titleValue}</title>`;
  let inBlock = false;
  let blockStart = 0;

  for (let i = 0; i < sourceLines.length; i++) {
    const stripped = sourceLines[i].trim();
    if (stripped.includes("<contextMappings>") && !inBlock) {
      inBlock = true;
      blockStart = i + 1;
    }
    if (inBlock && stripped.includes(searchPattern)) {
      start = blockStart;
    }
    if (inBlock && stripped.includes("</contextMappings>")) {
      if (start !== null) return [start, i + 1];
      inBlock = false;
      blockStart = 0;
    }
  }
  return [0, 0];
}

function getNodeDefLineRange(sourceLines, titleValue) {
  let inBlock = false;
  let blockStart = 0;

  for (let i = 0; i < sourceLines.length; i++) {
    const stripped = sourceLines[i].trim();
    if (stripped.includes("<contextNodes>")) {
      inBlock = true;
      blockStart = i + 1;
    }
    if (inBlock && stripped.includes("</contextNodes>")) {
      for (let j = i; j >= Math.max(blockStart - 1, i - 10); j--) {
        if (sourceLines[j].trim().includes(`<title>${titleValue}</title>`)) {
          return [blockStart, i + 1];
        }
      }
      inBlock = false;
    }
  }
  return [0, 0];
}

/**
 * Find the line range of a specific contextNodeMappings block within a
 * mapping, identified by its <contextNode>nodeName</contextNode> child.
 * Searches only within the given mapping line range to avoid false matches.
 */
function getNodeMappingLineRange(sourceLines, mappingLineRange, nodeName) {
  const [mStart, mEnd] = mappingLineRange;
  if (mStart === 0) return [0, 0];

  let inBlock = false;
  let blockStart = 0;

  for (let i = mStart - 1; i < mEnd; i++) {
    const stripped = sourceLines[i].trim();
    if (stripped.includes("<contextNodeMappings>") && !inBlock) {
      inBlock = true;
      blockStart = i + 1;
    }
    if (inBlock && stripped.includes("</contextNodeMappings>")) {
      // Check if this block contains our node
      for (let j = i; j >= Math.max(blockStart - 1, i - 5); j--) {
        if (
          sourceLines[j]
            .trim()
            .includes(`<contextNode>${nodeName}</contextNode>`)
        ) {
          return [blockStart, i + 1];
        }
      }
      inBlock = false;
      blockStart = 0;
    }
  }
  return [0, 0];
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

function discoverMappings(root, sourceLines) {
  const mappings = [];
  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    let idx = 0;
    for (const mapping of version.findall(nsTag("contextMappings"))) {
      const title = getText(mapping, "title") || `(unnamed-${idx})`;
      const defaultVal = getText(mapping, "default") || "false";
      const description = getText(mapping, "description") || "";

      const intents = [];
      for (const intentEl of mapping.findall(
        nsTag("contextMappingIntents")
      )) {
        const intent = getText(intentEl, "mappingIntent");
        if (intent) intents.push(intent);
      }

      const nodeObjects = {};
      for (const nodeMap of mapping.findall(nsTag("contextNodeMappings"))) {
        const nodeName = getText(nodeMap, "contextNode") || "(unknown)";
        const objName = getText(nodeMap, "object");
        const attrMappings = nodeMap.findall(
          nsTag("contextAttributeMappings")
        );
        nodeObjects[nodeName] = {
          object: objName,
          mapped_attributes: attrMappings.length,
        };
      }

      const lineRange = getMappingLineRange(sourceLines, title);

      mappings.push({
        index: idx + 1,
        title: title,
        default: defaultVal === "true",
        intents: intents,
        description: description.slice(0, 80),
        line_range: lineRange,
        node_count: Object.keys(nodeObjects).length,
        node_objects: nodeObjects,
      });
      idx++;
    }
  }
  return mappings;
}

function discoverNodes(root, sourceLines) {
  const nodes = [];
  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    for (const node of version.iter(nsTag("contextNodes"))) {
      const title = getText(node, "title");
      if (!title) continue;

      const display = getText(node, "displayName") || title;
      const transposable = getText(node, "transposable") === "true";

      let totalAttrs = 0;
      const customAttrs = [];
      let inheritedAttrs = 0;
      const tagMismatches = [];

      for (const attr of node.findall(nsTag("contextAttributes"))) {
        totalAttrs++;
        const attrTitle = getText(attr, "title") || "(unknown)";

        const tagTitles = [];
        for (const tagEl of attr.findall(nsTag("contextTags"))) {
          const t = getText(tagEl, "title");
          if (t) tagTitles.push(t);
        }
        const primaryTag = tagTitles.length > 0 ? tagTitles[0] : null;

        if (primaryTag && primaryTag !== attrTitle) {
          tagMismatches.push({ attribute: attrTitle, tag: primaryTag });
        }

        const inherited = getText(attr, "inheritedFrom");
        if (inherited) {
          inheritedAttrs++;
        } else {
          const dt = getText(attr, "dataType") || "?";
          const ft = getText(attr, "fieldType") || "?";
          customAttrs.push({
            title: attrTitle,
            tag: primaryTag || attrTitle,
            dataType: dt,
            fieldType: ft,
          });
        }
      }

      let parent = null;
      for (const attr of node.findall(nsTag("contextAttributes"))) {
        if (getText(attr, "title") === "ParentReference") {
          parent = getText(attr, "domainSet");
          break;
        }
      }

      const lineRange = getNodeDefLineRange(sourceLines, title);

      nodes.push({
        title: title,
        displayName: display,
        transposable: transposable,
        parent: parent,
        total_attributes: totalAttrs,
        inherited_attributes: inheritedAttrs,
        custom_attributes: customAttrs,
        tag_mismatches: tagMismatches,
        line_range: lineRange,
      });
    }
  }
  return nodes;
}

function buildTagLookup(root) {
  const lookup = {};
  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    for (const node of version.iter(nsTag("contextNodes"))) {
      const nodeTitle = getText(node, "title");
      if (!nodeTitle) continue;
      for (const attr of node.findall(nsTag("contextAttributes"))) {
        const attrTitle = getText(attr, "title");
        if (!attrTitle) continue;
        const tagEl = attr.find(nsTag("contextTags"));
        if (tagEl) {
          const tagTitle = getText(tagEl, "title");
          if (tagTitle) lookup[`${nodeTitle}::${attrTitle}`] = tagTitle;
        }
      }
    }
  }
  return lookup;
}

function discoverRemappings(root, tagLookup) {
  const remappings = [];
  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    for (const mapping of version.findall(nsTag("contextMappings"))) {
      const mappingTitle = getText(mapping, "title") || "(unnamed)";
      for (const nodeMap of mapping.findall(nsTag("contextNodeMappings"))) {
        const nodeName = getText(nodeMap, "contextNode") || "(unknown)";
        const objName = getText(nodeMap, "object") || "(unknown)";
        for (const attrMap of nodeMap.findall(
          nsTag("contextAttributeMappings")
        )) {
          const ctxAttr = getText(attrMap, "contextAttribute");
          const hyd = attrMap.find(nsTag("contextAttrHydrationDetails"));
          if (hyd) {
            const queryAttr = getText(hyd, "queryAttribute");
            const nested = hyd.find(nsTag("contextAttrHydrationDetails"));
            if (!nested && queryAttr && ctxAttr && queryAttr !== ctxAttr) {
              const tag =
                tagLookup[`${nodeName}::${ctxAttr}`] || ctxAttr;
              remappings.push({
                mapping: mappingTitle,
                node: nodeName,
                object: objName,
                contextAttribute: ctxAttr,
                tag: tag,
                queryAttribute: queryAttr,
              });
            }
          }
        }
      }
    }
  }
  return remappings;
}

/**
 * For a specific node, collect detailed mapping context from every mapping
 * that references it: SObject, line ranges, mapped attribute list.
 */
function discoverNodeMappingDetails(root, sourceLines, nodeName, mappings) {
  const details = [];
  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    for (const mapping of version.findall(nsTag("contextMappings"))) {
      const mappingTitle = getText(mapping, "title") || "(unnamed)";

      for (const nodeMap of mapping.findall(nsTag("contextNodeMappings"))) {
        const mapNodeName = getText(nodeMap, "contextNode");
        if (mapNodeName !== nodeName) continue;

        const objName = getText(nodeMap, "object") || "(no object)";
        const attrMaps = nodeMap.findall(
          nsTag("contextAttributeMappings")
        );

        // Collect mapped attributes with hydration info
        const mappedAttrs = [];
        for (const attrMap of attrMaps) {
          const ctxAttr =
            getText(attrMap, "contextAttribute") || "(unknown)";
          const hyd = attrMap.find(nsTag("contextAttrHydrationDetails"));
          let queryAttr = null;
          let hops = 0;
          if (hyd) {
            queryAttr = getText(hyd, "queryAttribute");
            // Count nesting depth
            let cursor = hyd;
            while (cursor) {
              const nested = cursor.find(
                nsTag("contextAttrHydrationDetails")
              );
              if (nested) {
                hops++;
                cursor = nested;
              } else {
                break;
              }
            }
          }
          mappedAttrs.push({
            contextAttribute: ctxAttr,
            queryAttribute: queryAttr,
            hops: hops,
          });
        }

        // Find line ranges
        const mappingInfo = mappings.find((m) => m.title === mappingTitle);
        const mappingLineRange = mappingInfo
          ? mappingInfo.line_range
          : [0, 0];
        const nodeMappingLineRange = getNodeMappingLineRange(
          sourceLines,
          mappingLineRange,
          nodeName
        );

        details.push({
          mapping: mappingTitle,
          isDefault: mappingInfo ? mappingInfo.default : false,
          object: objName,
          mapping_line_range: mappingLineRange,
          node_mapping_line_range: nodeMappingLineRange,
          mapped_attribute_count: attrMaps.length,
          mapped_attributes: mappedAttrs,
        });
      }
    }
  }
  return details;
}

// ---------------------------------------------------------------------------
// Output: tree printer
// ---------------------------------------------------------------------------

function printTree(nodes) {
  const childrenMap = {};
  for (const node of nodes) {
    const p = node.parent || null;
    if (!childrenMap[p]) childrenMap[p] = [];
    childrenMap[p].push(node);
  }

  const allTitles = new Set(nodes.map((n) => n.title));
  const roots = nodes.filter(
    (n) => n.parent === null || !allTitles.has(n.parent)
  );

  function printNode(node, prefix, isLast) {
    const connector = isLast ? "└── " : "├── ";
    const trans = node.transposable ? " [T]" : "";
    const customCount = node.custom_attributes.length;
    const lr = node.line_range;
    const lineInfo = lr[0] > 0 ? ` (L${lr[0]}-${lr[1]})` : "";
    console.log(
      `${prefix}${connector}${node.title}: ${node.total_attributes} attrs (${customCount} custom)${trans}${lineInfo}`
    );

    const children = childrenMap[node.title] || [];
    for (let i = 0; i < children.length; i++) {
      const childPrefix = prefix + (isLast ? "    " : "│   ");
      printNode(children[i], childPrefix, i === children.length - 1);
    }
  }

  for (const root of roots) {
    const lr = root.line_range;
    const lineInfo = lr[0] > 0 ? ` (L${lr[0]}-${lr[1]})` : "";
    const trans = root.transposable ? " [T]" : "";
    const customCount = root.custom_attributes.length;
    console.log(
      `${root.title} (root): ${root.total_attributes} attrs (${customCount} custom)${trans}${lineInfo}`
    );
    const children = childrenMap[root.title] || [];
    for (let j = 0; j < children.length; j++) {
      printNode(children[j], "", j === children.length - 1);
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Output: compact default
// ---------------------------------------------------------------------------

function printCompact(filepath, root, sourceLines, mappings, nodes) {
  const masterLabel =
    getText(root, "masterLabel") ||
    path.basename(filepath, path.extname(filepath));
  const inheritedFrom = getText(root, "inheritedFrom") || "(none)";
  const inheritedVersion =
    getText(root, "inheritedFromVersion") || "(none)";
  const clonedFrom = getText(root, "clonedFrom") || null;

  console.log(`Context Definition: ${masterLabel}`);
  console.log(`  File: ${filepath}`);
  if (clonedFrom) {
    console.log(`  Cloned from: ${clonedFrom}`);
  } else {
    console.log(
      `  Inherits from: ${inheritedFrom} (v${inheritedVersion})`
    );
  }

  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    const vNum = getText(version, "versionNumber") || "?";
    const vDate = getText(version, "startDate") || "?";
    const vActive = getText(version, "isActive") || "?";
    console.log(
      `  Version: ${vNum}, Start Date: ${vDate}, Active: ${vActive}`
    );
  }

  // Mapping summary — one line each
  console.log();
  console.log("MAPPINGS");
  for (const m of mappings) {
    const def = m.default ? " [DEFAULT]" : "";
    const lr = m.line_range;
    const lineInfo = lr[0] > 0 ? `L${lr[0]}-${lr[1]}` : "?";
    console.log(
      `  ${m.title}${def} (${lineInfo}) — ${m.intents.join(", ")} — ${m.node_count} nodes`
    );
  }

  // Node hierarchy
  console.log();
  console.log("NODE HIERARCHY");
  printTree(nodes);

  // Summary
  const totalCustom = nodes.reduce(
    (sum, n) => sum + n.custom_attributes.length,
    0
  );
  const totalAttrs = nodes.reduce(
    (sum, n) => sum + n.total_attributes,
    0
  );
  console.log(
    `Summary: ${nodes.length} nodes, ${totalAttrs} attributes (${totalCustom} custom), ${mappings.length} mappings`
  );
}

// ---------------------------------------------------------------------------
// Output: enriched --node
// ---------------------------------------------------------------------------

function printNodeDetail(
  filepath,
  root,
  sourceLines,
  nodeFilter,
  nodes,
  mappings,
  remappings
) {
  const node = nodes.find((n) => n.title === nodeFilter);
  if (!node) {
    console.log(`Node '${nodeFilter}' not found.`);
    console.log(
      `Available nodes: ${nodes.map((n) => n.title).join(", ")}`
    );
    process.exit(1);
  }

  const lr = node.line_range;

  // Header
  console.log(`Node: ${node.title}`);
  console.log(`  Display Name: ${node.displayName}`);
  console.log(`  Parent: ${node.parent || "(root)"}`);
  console.log(`  Transposable: ${node.transposable}`);
  console.log(
    lr[0] > 0
      ? `  Node Definition: lines ${lr[0]}-${lr[1]}`
      : "  Node Definition: line range unknown"
  );
  console.log(`  Total Attributes: ${node.total_attributes}`);
  console.log(`  Inherited: ${node.inherited_attributes}`);
  console.log(`  Custom: ${node.custom_attributes.length}`);

  // Custom attributes table
  if (node.custom_attributes.length > 0) {
    console.log();
    console.log("  CUSTOM ATTRIBUTES (non-inherited)");
    console.log(
      `    ${"Attribute".padEnd(40)} ${"Tag".padEnd(40)} ${"Type".padEnd(12)} Direction`
    );
    console.log(
      `    ${"-".repeat(40)} ${"-".repeat(40)} ${"-".repeat(12)} ${"-".repeat(12)}`
    );
    for (const attr of node.custom_attributes) {
      let tagDisplay = attr.tag;
      if (attr.tag !== attr.title) tagDisplay = `${attr.tag} ***`;
      console.log(
        `    ${attr.title.padEnd(40)} ${tagDisplay.padEnd(40)} ${attr.dataType.padEnd(12)} ${attr.fieldType}`
      );
    }
  }

  // Enriched mapping detail
  const mappingDetails = discoverNodeMappingDetails(
    root,
    sourceLines,
    nodeFilter,
    mappings
  );

  if (mappingDetails.length > 0) {
    console.log();
    console.log("  MAPPING CONTEXT");
    console.log(
      "  Each mapping below shows where this node is mapped, the target"
    );
    console.log(
      "  SObject, and line ranges for inserting new attribute mappings."
    );

    for (const detail of mappingDetails) {
      const def = detail.isDefault ? " [DEFAULT]" : "";
      const mlr = detail.mapping_line_range;
      const nlr = detail.node_mapping_line_range;
      console.log();
      console.log(`    ${detail.mapping}${def}`);
      console.log(`      SObject: ${detail.object}`);
      console.log(
        mlr[0] > 0
          ? `      Mapping block: lines ${mlr[0]}-${mlr[1]}`
          : "      Mapping block: line range unknown"
      );
      console.log(
        nlr[0] > 0
          ? `      Node mapping: lines ${nlr[0]}-${nlr[1]}  <-- insert new <contextAttributeMappings> here`
          : "      Node mapping: line range unknown"
      );
      console.log(
        `      Mapped attributes: ${detail.mapped_attribute_count}`
      );

      // Show only the custom/remapped attributes — skip standard 1:1 mappings
      const interesting = detail.mapped_attributes.filter(
        (a) =>
          a.hops > 0 ||
          (a.queryAttribute && a.queryAttribute !== a.contextAttribute)
      );
      if (interesting.length > 0) {
        console.log("      Remapped/derived fields:");
        for (const a of interesting) {
          const hopLabel = a.hops > 0 ? ` (${a.hops + 1}-hop)` : "";
          console.log(
            `        ${detail.object}.${(a.queryAttribute || "?").padEnd(35)} -> ${a.contextAttribute}${hopLabel}`
          );
        }
      }
    }
  }

  // Field remappings for this node (across all mappings)
  const nodeRemaps = remappings.filter((r) => r.node === nodeFilter);
  if (nodeRemaps.length > 0) {
    console.log();
    console.log(
      "  FIELD NAME MAP (SObject field != context attribute)"
    );
    for (const r of nodeRemaps) {
      let tagInfo = "";
      if (r.tag !== r.contextAttribute) tagInfo = `  tag: ${r.tag}`;
      console.log(
        `    ${r.object}.${r.queryAttribute.padEnd(30)} attr: ${r.contextAttribute.padEnd(30)}${tagInfo}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Output: full --all (original holistic view)
// ---------------------------------------------------------------------------

function printAll(
  filepath,
  root,
  sourceLines,
  mappings,
  nodes,
  remappings
) {
  const masterLabel =
    getText(root, "masterLabel") ||
    path.basename(filepath, path.extname(filepath));
  const inheritedFrom = getText(root, "inheritedFrom") || "(none)";
  const inheritedVersion =
    getText(root, "inheritedFromVersion") || "(none)";
  const clonedFrom = getText(root, "clonedFrom") || null;

  console.log(`Context Definition: ${masterLabel}`);
  console.log(`  File: ${filepath}`);
  console.log(`  Total lines: ${sourceLines.length}`);
  if (clonedFrom) {
    console.log(`  Cloned from: ${clonedFrom}`);
  } else {
    console.log(
      `  Inherits from: ${inheritedFrom} (v${inheritedVersion})`
    );
  }

  for (const version of root.iter(nsTag("contextDefinitionVersions"))) {
    const vNum = getText(version, "versionNumber") || "?";
    const vDate = getText(version, "startDate") || "?";
    const vActive = getText(version, "isActive") || "?";
    console.log(
      `  Version: ${vNum}, Start Date: ${vDate}, Active: ${vActive}`
    );
  }

  console.log();

  // Mapping blocks — full detail
  console.log("=".repeat(70));
  console.log("MAPPING BLOCKS");
  console.log("=".repeat(70));
  for (const m of mappings) {
    const defaultMarker = m.default ? " [DEFAULT]" : "";
    const lr = m.line_range;
    const lineInfo =
      lr[0] > 0 ? `lines ${lr[0]}-${lr[1]}` : "lines unknown";
    console.log(
      `\n  ${m.index}. ${m.title}${defaultMarker} (${lineInfo})`
    );
    console.log(`     Intents: ${m.intents.join(", ")}`);
    if (m.description) {
      console.log(`     Description: ${m.description}`);
    }
    console.log(`     Nodes: ${m.node_count}`);
    for (const [nodeName, info] of Object.entries(m.node_objects)) {
      const obj = info.object || "(no object)";
      console.log(
        `       ${nodeName} -> ${obj} (${info.mapped_attributes} attrs)`
      );
    }
  }

  console.log();

  // Node hierarchy
  console.log("=".repeat(70));
  console.log("NODE HIERARCHY");
  console.log("=".repeat(70));
  console.log();
  printTree(nodes);

  // Remappings
  if (remappings.length > 0) {
    console.log("=".repeat(70));
    console.log("FIELD NAME MAP (SObject field != context attribute)");
    console.log(
      "  SObject Field          = field on the physical object"
    );
    console.log(
      "  Context Attribute      = name in mappings / updateContextAttributes()"
    );
    console.log(
      "  Tag Name               = name in queryTags() / pricing procedures"
    );
    console.log("=".repeat(70));
    for (const r of remappings) {
      let tagInfo = "";
      if (r.tag !== r.contextAttribute) tagInfo = `  tag: ${r.tag}`;
      console.log(
        `  ${r.object}.${r.queryAttribute.padEnd(35)} attr: ${r.contextAttribute.padEnd(35)}${tagInfo}`
      );
    }
  }

  // Summary
  const totalCustom = nodes.reduce(
    (sum, n) => sum + n.custom_attributes.length,
    0
  );
  const totalAttrs = nodes.reduce(
    (sum, n) => sum + n.total_attributes,
    0
  );
  console.log();
  console.log(
    `Summary: ${nodes.length} nodes, ${totalAttrs} attributes (${totalCustom} custom), ${mappings.length} mappings, ${remappings.length} field remappings`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

  const asJson = process.argv.includes("--json");
  const showAll = process.argv.includes("--all");
  let nodeFilter = null;
  const nodeIdx = process.argv.indexOf("--node");
  if (nodeIdx !== -1 && nodeIdx + 1 < process.argv.length) {
    nodeFilter = process.argv[nodeIdx + 1];
  }

  let root;
  let fileContent;
  try {
    fileContent = fs.readFileSync(filepath, "utf8");
    root = parseXML(fileContent);
  } catch (e) {
    console.log(`XML parse error: ${e.message}`);
    process.exit(1);
  }

  const sourceLines = fileContent.split("\n");

  const mappings = discoverMappings(root, sourceLines);
  const nodes = discoverNodes(root, sourceLines);
  const tagLookup = buildTagLookup(root);
  const remappings = discoverRemappings(root, tagLookup);

  // --json: full structured data
  if (asJson) {
    const masterLabel =
      getText(root, "masterLabel") ||
      path.basename(filepath, path.extname(filepath));
    const output = {
      file: filepath,
      masterLabel: masterLabel,
      inheritedFrom: getText(root, "inheritedFrom") || "(none)",
      inheritedFromVersion:
        getText(root, "inheritedFromVersion") || "(none)",
      clonedFrom: getText(root, "clonedFrom") || null,
      mappings: mappings,
      nodes: nodes,
      remappings: remappings,
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  }

  // --node: enriched detail for one node
  if (nodeFilter) {
    printNodeDetail(
      filepath,
      root,
      sourceLines,
      nodeFilter,
      nodes,
      mappings,
      remappings
    );
    process.exit(0);
  }

  // --all: full holistic view
  if (showAll) {
    printAll(filepath, root, sourceLines, mappings, nodes, remappings);
    process.exit(0);
  }

  // Default: compact summary
  printCompact(filepath, root, sourceLines, mappings, nodes);
}

if (require.main === module) {
  main();
}

module.exports = { main };
