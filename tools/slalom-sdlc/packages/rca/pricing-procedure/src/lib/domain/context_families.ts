const AMBIGUITY_FAMILIES = {
  pricewaterfall: ['PriceWaterfall', 'PriceWaterFall', 'price_water_fall', 'PriceWaterfallIdentifier'],
  subtotal: ['Subtotal', 'SubTotal', 'ItemNetTotalPrice'],
  productsellingmodel: ['ProductSellingModel', 'ProductSellingModelId'],
} as const;

export type AmbiguityFamilyName = keyof typeof AMBIGUITY_FAMILIES;

export interface ContextFamilyMatch {
  family: AmbiguityFamilyName;
  members: string[];
}

export function normalizedContextKey(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizedSymbol(value: string | null | undefined): string {
  return normalizedContextKey(value);
}

export function familyMatches(contextTag: string | null | undefined): ContextFamilyMatch[] {
  const normalized = normalizedContextKey(contextTag);
  const rows: ContextFamilyMatch[] = [];
  for (const [family, members] of Object.entries(AMBIGUITY_FAMILIES) as Array<[
    AmbiguityFamilyName,
    readonly string[],
  ]>) {
    const memberNorms = new Set(members.map((member) => normalizedContextKey(member)));
    if (memberNorms.has(normalized)) {
      rows.push({ family, members: [...members] });
    }
  }
  return rows;
}

export function relatedFamilyMembers(contextTag: string | null | undefined): string[] {
  const members = new Set<string>();
  if (contextTag) {
    members.add(contextTag);
  }
  for (const match of familyMatches(contextTag)) {
    for (const member of match.members) {
      members.add(member);
    }
  }
  return Array.from(members).sort();
}
