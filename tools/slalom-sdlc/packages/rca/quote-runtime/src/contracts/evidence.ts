import { z } from 'zod';

export const EVIDENCE_LEVELS = ['documented', 'repo_proven', 'org_proven', 'inferred', 'unknown'] as const;

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const evidenceLevelSchema = z.enum(EVIDENCE_LEVELS);

export const evidenceItemSchema = z
  .object({
    claim: z.string().min(1, 'claim is required'),
    evidence_level: evidenceLevelSchema,
    proof_source: z.array(z.string().min(1, 'proof_source entries must be non-empty')),
    limitations: z.string().min(1, 'limitations is required'),
    source_refs: z.array(z.string().min(1, 'source_refs entries must be non-empty'))
  })
  .strict();

export const evidenceListSchema = z.array(evidenceItemSchema);

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export function parseEvidenceItem(value: unknown): EvidenceItem {
  return evidenceItemSchema.parse(value);
}

export function parseEvidenceList(value: unknown): EvidenceItem[] {
  return evidenceListSchema.parse(value);
}

export function isEvidenceItem(value: unknown): value is EvidenceItem {
  return evidenceItemSchema.safeParse(value).success;
}
