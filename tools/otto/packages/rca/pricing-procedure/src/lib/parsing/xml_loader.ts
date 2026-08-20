import { readFileSync, existsSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { PricingCliError } from '../contracts/errors';

export const NS = Object.freeze({ m: 'http://soap.sforce.com/2006/04/metadata' });

interface XmlElementNodeInit {
  rawName: string;
  namespaceUri: string | null;
  attributes: Record<string, string>;
  parent: XmlElementNode | null;
}

export class XmlElementNode {
  readonly rawName: string;
  readonly namespaceUri: string | null;
  readonly attributes: Record<string, string>;
  readonly children: XmlElementNode[] = [];
  readonly parent: XmlElementNode | null;
  private textChunks: string[] = [];

  constructor(init: XmlElementNodeInit) {
    this.rawName = init.rawName;
    this.namespaceUri = init.namespaceUri;
    this.attributes = init.attributes;
    this.parent = init.parent;
  }

  get localName(): string {
    const parts = this.rawName.split(':');
    return parts[parts.length - 1] ?? this.rawName;
  }

  get tag(): string {
    return this.namespaceUri ? `{${this.namespaceUri}}${this.localName}` : this.localName;
  }

  get text(): string | null {
    const joined = this.textChunks.join('');
    const trimmed = joined.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  appendText(value: string): void {
    if (value.length > 0) {
      this.textChunks.push(value);
    }
  }
}

function nodeTypeName(nodeType: number): string {
  switch (nodeType) {
    case 1:
      return 'element';
    case 3:
      return 'text';
    case 4:
      return 'cdata';
    case 7:
      return 'processing_instruction';
    case 8:
      return 'comment';
    case 9:
      return 'document';
    default:
      return `node_type_${nodeType}`;
  }
}

function buildAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute) {
      attributes[attribute.name] = attribute.value;
    }
  }
  return attributes;
}

function buildNodeTree(element: Element, parent: XmlElementNode | null, path: string): XmlElementNode {
  const node = new XmlElementNode({
    rawName: element.tagName,
    namespaceUri: element.namespaceURI,
    attributes: buildAttributes(element),
    parent,
  });

  for (let index = 0; index < element.childNodes.length; index += 1) {
    const childNode = element.childNodes.item(index);
    if (!childNode) {
      continue;
    }

    if (childNode.nodeType === 1) {
      const childElement = childNode as Element;
      node.children.push(buildNodeTree(childElement, node, path));
      continue;
    }

    if (childNode.nodeType === 3 || childNode.nodeType === 4) {
      node.appendText(childNode.nodeValue ?? '');
      continue;
    }

    if (childNode.nodeType === 7 || childNode.nodeType === 8) {
      continue;
    }

    throw new PricingCliError(
      'xml_parse_error',
      `XML parse error for ${path}`,
      { path, parse_error: `Unsupported XML child node type under <${element.tagName}>: ${nodeTypeName(childNode.nodeType)}.` },
      'Validate the XML file and rerun.',
    );
  }

  return node;
}

export function parseXml(path: string): XmlElementNode {
  if (!existsSync(path)) {
    throw new PricingCliError('file_not_found', `File not found: ${path}`, { path }, 'Check the path and rerun.');
  }

  const xml = readFileSync(path, 'utf8');
  const parseErrors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => {
        parseErrors.push(message);
      },
      error: (message) => {
        parseErrors.push(message);
      },
      fatalError: (message) => {
        parseErrors.push(message);
      },
    },
  }).parseFromString(xml, 'text/xml');

  if (parseErrors.length > 0) {
    throw new PricingCliError(
      'xml_parse_error',
      `XML parse error for ${path}`,
      { path, parse_error: parseErrors.join('; ') },
      'Validate the XML file and rerun.',
    );
  }

  const rootElement = document.documentElement;
  if (!rootElement) {
    throw new PricingCliError(
      'xml_parse_error',
      `XML parse error for ${path}`,
      { path, parse_error: 'Missing document element.' },
      'Validate the XML file and rerun.',
    );
  }

  return buildNodeTree(rootElement, null, path);
}

function pathSegments(path: string): string[] {
  const normalized = path.startsWith('.//') ? path.slice(3) : path;
  return normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

interface PathSegmentMatcher {
  raw: string;
  prefix: string | null;
  localName: string;
  expectedNamespaceUri: string | null;
}

function parsePathSegment(segment: string): PathSegmentMatcher {
  const [maybePrefix, maybeLocalName] = segment.includes(':') ? segment.split(':', 2) : [null, segment];
  const prefix = maybePrefix && maybeLocalName ? maybePrefix : null;
  const localName = maybeLocalName ?? maybePrefix ?? segment;
  const expectedNamespaceUri = prefix ? NS[prefix as keyof typeof NS] ?? null : null;
  return { raw: segment, prefix, localName, expectedNamespaceUri };
}

function matchesPathSegment(node: XmlElementNode, matcher: PathSegmentMatcher): boolean {
  if (node.localName !== matcher.localName) {
    return false;
  }

  if (!matcher.prefix) {
    return true;
  }

  const nodePrefix = node.rawName.includes(':') ? node.rawName.split(':', 2)[0] : null;
  if (matcher.expectedNamespaceUri) {
    return node.namespaceUri === matcher.expectedNamespaceUri;
  }

  return nodePrefix === matcher.prefix;
}

function collectDescendants(node: XmlElementNode, matcher: PathSegmentMatcher, results: XmlElementNode[]): void {
  for (const child of node.children) {
    if (matchesPathSegment(child, matcher)) {
      results.push(child);
    }
    collectDescendants(child, matcher, results);
  }
}

export function findAll(node: XmlElementNode | null | undefined, path: string): XmlElementNode[] {
  if (!node) {
    return [];
  }

  if (path.startsWith('.//')) {
    const segments = pathSegments(path).map(parsePathSegment);
    if (segments.length === 0) {
      return [];
    }

    let current: XmlElementNode[] = [];
    collectDescendants(node, segments[0], current);
    for (const matcher of segments.slice(1)) {
      current = current.flatMap((candidate) => candidate.children.filter((child) => matchesPathSegment(child, matcher)));
    }
    return current;
  }

  let current: XmlElementNode[] = [node];
  for (const matcher of pathSegments(path).map(parsePathSegment)) {
    current = current.flatMap((candidate) => candidate.children.filter((child) => matchesPathSegment(child, matcher)));
    if (current.length === 0) {
      break;
    }
  }
  return current;
}

export function txt(node: XmlElementNode | null | undefined, path: string): string | null {
  const [firstMatch] = findAll(node, path);
  return firstMatch?.text ?? null;
}

export function loadExpressionSetRoot(path: string): XmlElementNode {
  const root = parseXml(path);
  const tag = root.tag.split('}').at(-1) ?? root.tag;
  if (tag !== 'ExpressionSetDefinition' || root.namespaceUri !== NS.m) {
    const code = tag === 'ExpressionSetDefinition' ? 'wrong_root_tag' : 'not_expression_set_definition';
    throw new PricingCliError(
      code,
      `Expected ExpressionSetDefinition root but found ${tag}.`,
      { path, root_tag: tag, namespace_uri: root.namespaceUri },
      'Use a pricing procedure ExpressionSetDefinition metadata file.',
    );
  }
  return root;
}

export function loadContextRoot(path: string): XmlElementNode {
  const root = parseXml(path);
  const tag = root.tag.split('}').at(-1) ?? root.tag;
  if (tag !== 'ContextDefinition' || root.namespaceUri !== NS.m) {
    throw new PricingCliError(
      'context_parse_error',
      `Expected ContextDefinition root but found ${tag}.`,
      { path, root_tag: tag, namespace_uri: root.namespaceUri },
      'Use a ContextDefinition metadata file.',
    );
  }
  return root;
}

export const parse_xml = parseXml;
export const findall = findAll;
export const load_expression_set_root = loadExpressionSetRoot;
export const load_context_root = loadContextRoot;
