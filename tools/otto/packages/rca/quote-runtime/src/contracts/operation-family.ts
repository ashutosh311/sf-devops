export const OPERATION_FAMILIES = [
  'pst_place',
  'initiate_amendment',
  'initiate_renewal',
  'asset_add_to_renewal'
] as const;

export type OperationFamily = (typeof OPERATION_FAMILIES)[number];

export const NORMALIZED_OPERATION_FAMILY_ALIASES: Readonly<Record<string, OperationFamily>> = Object.freeze({
  pst_place: 'pst_place',
  initiate_amendment: 'initiate_amendment',
  initiate_renewal: 'initiate_renewal',
  asset_add_to_renewal: 'asset_add_to_renewal',
  amendment: 'initiate_amendment',
  renewal: 'initiate_renewal',
  add_asset: 'asset_add_to_renewal'
});

export function normalizeOperationFamily(input: string): OperationFamily {
  const normalized = NORMALIZED_OPERATION_FAMILY_ALIASES[input];

  if (normalized) {
    return normalized;
  }

  throw new Error(`Unsupported operation-family: ${input}`);
}
