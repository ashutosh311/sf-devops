#!/usr/bin/env node
/**
 * sf-xml-parser.js - Zero-dependency XML parser for Salesforce metadata files.
 *
 * Provides an XmlElement class compatible with Python's xml.etree.ElementTree API:
 *   find(tag)    — first direct child matching namespaced tag, or null
 *   findall(tag) — all direct children matching namespaced tag
 *   iter(tag)    — all descendants recursively (pre-order depth-first), matching tag
 *   .text        — string text content or null
 *
 * Tags are stored in expanded form: {http://namespace}tagName
 * (identical to Python ElementTree convention).
 */

"use strict";

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeEntities(str) {
  return str.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m]);
}

class XmlElement {
  constructor(tag, children, text) {
    this.tag = tag;
    this.children = children || [];
    this.text = text || null;
  }

  /**
   * Return the first direct child whose tag matches, or null.
   */
  find(tag) {
    for (const child of this.children) {
      if (child.tag === tag) return child;
    }
    return null;
  }

  /**
   * Return all direct children whose tag matches.
   */
  findall(tag) {
    return this.children.filter((c) => c.tag === tag);
  }

  /**
   * Yield all descendants (pre-order depth-first) whose tag matches,
   * including this element itself if it matches.
   */
  iter(tag) {
    const results = [];
    const walk = (el) => {
      if (el.tag === tag) results.push(el);
      for (const child of el.children) walk(child);
    };
    walk(this);
    return results;
  }
}

/**
 * Parse an XML string and return the root XmlElement.
 *
 * Handles:
 *   - Namespace expansion via xmlns attributes
 *   - Self-closing tags
 *   - Basic XML entities (&amp; &lt; &gt; &quot; &apos;)
 *   - XML declaration and comment skipping
 *
 * Does NOT handle: CDATA, DTDs, processing instructions (beyond <?xml?>),
 * or attributes beyond xmlns.
 */
function parseXML(xmlString) {
  let pos = 0;
  const src = xmlString;
  const len = src.length;

  function skipWhitespace() {
    while (pos < len && /\s/.test(src[pos])) pos++;
  }

  function skipDeclarationsAndComments() {
    while (pos < len) {
      skipWhitespace();
      if (pos >= len || src[pos] !== "<") break;
      if (src.startsWith("<?", pos)) {
        const end = src.indexOf("?>", pos);
        if (end === -1) throw new Error("Unterminated XML declaration");
        pos = end + 2;
      } else if (src.startsWith("<!--", pos)) {
        const end = src.indexOf("-->", pos);
        if (end === -1) throw new Error("Unterminated comment");
        pos = end + 3;
      } else {
        break;
      }
    }
  }

  /**
   * Parse attributes from a tag string, returning { attrs, nsMap }.
   * nsMap maps prefix -> URI. attrs contains non-xmlns attributes.
   */
  function parseAttrs(attrStr, parentNsMap) {
    const nsMap = Object.assign({}, parentNsMap);
    const re = /([a-zA-Z_][\w.:_-]*)=(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(attrStr)) !== null) {
      const name = m[1];
      const value = m[2] !== undefined ? m[2] : m[3];
      if (name === "xmlns") {
        nsMap[""] = value;
      } else if (name.startsWith("xmlns:")) {
        nsMap[name.slice(6)] = value;
      }
    }
    return nsMap;
  }

  /**
   * Expand a tag name using the namespace map.
   * "prefix:local" -> "{uri}local"
   * "local"        -> "{defaultUri}local" (if default ns exists)
   */
  function expandTag(rawTag, nsMap) {
    const colonIdx = rawTag.indexOf(":");
    if (colonIdx !== -1) {
      const prefix = rawTag.slice(0, colonIdx);
      const local = rawTag.slice(colonIdx + 1);
      if (nsMap[prefix]) return `{${nsMap[prefix]}}${local}`;
      return rawTag;
    }
    if (nsMap[""]) return `{${nsMap[""]}}${rawTag}`;
    return rawTag;
  }

  /**
   * Parse a single element starting at '<'. Returns an XmlElement.
   */
  function parseElement(parentNsMap) {
    skipDeclarationsAndComments();

    if (pos >= len || src[pos] !== "<") {
      throw new Error(`Expected '<' at position ${pos}`);
    }
    pos++; // skip '<'

    // Read tag name and attributes up to '>' or '/>'
    const tagStart = pos;
    while (pos < len && src[pos] !== ">" && src[pos] !== "/" && !/\s/.test(src[pos])) pos++;
    const rawTag = src.slice(tagStart, pos);

    // Read rest of opening tag for attributes
    const attrStart = pos;
    let selfClosing = false;
    while (pos < len) {
      if (src[pos] === "/" && pos + 1 < len && src[pos + 1] === ">") {
        selfClosing = true;
        pos += 2;
        break;
      }
      if (src[pos] === ">") {
        pos++;
        break;
      }
      pos++;
    }
    const attrStr = src.slice(attrStart, selfClosing ? pos - 2 : pos - 1);
    const nsMap = parseAttrs(attrStr, parentNsMap);
    const tag = expandTag(rawTag, nsMap);

    if (selfClosing) {
      return new XmlElement(tag, [], null);
    }

    // Parse children and text content
    const children = [];
    let textParts = [];

    while (pos < len) {
      // Check for closing tag
      if (src.startsWith("</", pos)) {
        // Collect text before closing tag
        const closeEnd = src.indexOf(">", pos);
        if (closeEnd === -1) throw new Error(`Unterminated closing tag at position ${pos}`);
        pos = closeEnd + 1;
        break;
      }

      // Skip comments inside elements
      if (src.startsWith("<!--", pos)) {
        const end = src.indexOf("-->", pos);
        if (end === -1) throw new Error("Unterminated comment");
        pos = end + 3;
        continue;
      }

      // Check for child element
      if (src[pos] === "<") {
        children.push(parseElement(nsMap));
        continue;
      }

      // Accumulate text content
      const textStart = pos;
      while (pos < len && src[pos] !== "<") pos++;
      const chunk = src.slice(textStart, pos);
      if (chunk.trim()) textParts.push(decodeEntities(chunk));
    }

    const text = textParts.length > 0 ? textParts.join("").trim() : null;
    return new XmlElement(tag, children, text);
  }

  skipDeclarationsAndComments();
  return parseElement({});
}

module.exports = { parseXML, XmlElement };

