import type {
  NormalizedContextAttributeEntry,
  NormalizedContextAttributeMapping,
  NormalizedContextDefinition,
  NormalizedContextHydrationDetail,
  NormalizedContextNodeMatch,
  NormalizedContextQueryAttributeEntry,
  NormalizedContextTagEntry,
} from '../../contracts/types';
import { findAll, loadContextRoot, txt } from '../xml_loader';

export function loadContextDefinition(path: string): NormalizedContextDefinition {
  const root = loadContextRoot(path);
  const attributes: Record<string, NormalizedContextAttributeEntry[]> = {};
  const tags: Record<string, NormalizedContextTagEntry[]> = {};
  const queryAttributes: Record<string, NormalizedContextQueryAttributeEntry[]> = {};
  const attributeMappings: NormalizedContextAttributeMapping[] = [];
  const attributeMappingIndex: Record<string, NormalizedContextAttributeMapping[]> = {};
  const tagMappingIndex: Record<string, NormalizedContextAttributeMapping[]> = {};
  const contextNodes: NormalizedContextNodeMatch[] = [];

  for (const attributeNode of findAll(root, './/m:contextAttributes')) {
    const title = txt(attributeNode, 'm:title');
    const displayName = txt(attributeNode, 'm:displayName');
    const dataType = txt(attributeNode, 'm:dataType');
    const contextTags = findAll(attributeNode, 'm:contextTags/m:title')
      .map((tagNode) => tagNode.text)
      .filter((value): value is string => value !== null);

    if (title) {
      const attributeEntry: NormalizedContextAttributeEntry = {
        attribute_title: title,
        display_name: displayName,
        data_type: dataType,
        context_tags: contextTags,
      };
      attributes[title] ??= [];
      attributes[title].push(attributeEntry);
    }

    for (const tagTitle of contextTags) {
      const tagEntry: NormalizedContextTagEntry = {
        attribute_title: title,
        display_name: displayName,
        data_type: dataType,
      };
      tags[tagTitle] ??= [];
      tags[tagTitle].push(tagEntry);
    }
  }

  for (const nodeMapping of findAll(root, './/m:contextNodeMappings')) {
    const contextNode = txt(nodeMapping, 'm:contextNode');
    const inheritedFrom = txt(nodeMapping, 'm:inheritedFrom');
    const objectName = txt(nodeMapping, 'm:object');

    contextNodes.push({
      context_node: contextNode,
      object_name: objectName,
      inherited_from: inheritedFrom,
    });

    for (const mappingNode of findAll(nodeMapping, 'm:contextAttributeMappings')) {
      const contextAttribute = txt(mappingNode, 'm:contextAttribute');
      const contextInputAttributeName = txt(mappingNode, 'm:contextInputAttributeName');
      const mappingInheritedFrom = txt(mappingNode, 'm:inheritedFrom');
      const hydrationDetails: NormalizedContextHydrationDetail[] = [];

      for (const hydrationNode of findAll(mappingNode, 'm:contextAttrHydrationDetails')) {
        const detail: NormalizedContextHydrationDetail = {
          object_name: txt(hydrationNode, 'm:objectName'),
          query_attribute: txt(hydrationNode, 'm:queryAttribute'),
          inherited_from: txt(hydrationNode, 'm:inheritedFrom'),
        };
        hydrationDetails.push(detail);

        if (detail.query_attribute) {
          const queryAttributeEntry: NormalizedContextQueryAttributeEntry = {
            context_attribute: contextAttribute,
            context_input_attribute_name: contextInputAttributeName,
            context_node: contextNode,
            object_name: detail.object_name ?? objectName,
            query_attribute: detail.query_attribute,
            inherited_from: detail.inherited_from ?? mappingInheritedFrom,
          };
          queryAttributes[detail.query_attribute] ??= [];
          queryAttributes[detail.query_attribute].push(queryAttributeEntry);
        }
      }

      const mappingEntry: NormalizedContextAttributeMapping = {
        context_attribute: contextAttribute,
        context_input_attribute_name: contextInputAttributeName,
        context_node: contextNode,
        context_node_object: objectName,
        inherited_from: mappingInheritedFrom,
        hydration_details: hydrationDetails,
      };
      attributeMappings.push(mappingEntry);

      if (contextAttribute) {
        attributeMappingIndex[contextAttribute] ??= [];
        attributeMappingIndex[contextAttribute].push(mappingEntry);

        for (const attributeEntry of attributes[contextAttribute] ?? []) {
          for (const tagTitle of attributeEntry.context_tags) {
            tagMappingIndex[tagTitle] ??= [];
            tagMappingIndex[tagTitle].push(mappingEntry);
          }
        }
      }
    }
  }

  return {
    path: String(path),
    attributes,
    tags,
    query_attributes: queryAttributes,
    attribute_mappings: attributeMappings,
    attribute_mapping_index: attributeMappingIndex,
    tag_mapping_index: tagMappingIndex,
    context_nodes: contextNodes,
  };
}

export const load_context_definition = loadContextDefinition;
