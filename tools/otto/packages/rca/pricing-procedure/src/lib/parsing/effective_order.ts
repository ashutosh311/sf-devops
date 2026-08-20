export interface EffectiveOrderMetadata {
  index: number;
  basis: 'sequence_then_parent_then_name_then_xml_index';
  uncertainty: 'metadata ordering only; runtime execution semantics remain source-bounded';
}

export interface EffectiveOrderStepLike {
  sequenceNumber?: string | null;
  parentStep?: string | null;
  name?: string | null;
  xml_index?: number | null;
}

export type EffectivelyOrderedStep<T extends EffectiveOrderStepLike> = T & {
  effective_order: EffectiveOrderMetadata;
};

function sequenceSortValue(step: EffectiveOrderStepLike): number {
  const raw = String(step.sequenceNumber ?? '');
  return /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : 999999;
}

export function computeEffectiveOrder<T extends EffectiveOrderStepLike>(
  steps: readonly T[],
): Array<EffectivelyOrderedStep<T>> {
  const ordered = [...steps].sort((left, right) => {
    const sequenceDelta = sequenceSortValue(left) - sequenceSortValue(right);
    if (sequenceDelta !== 0) {
      return sequenceDelta;
    }

    const parentDelta = (left.parentStep ?? '').localeCompare(right.parentStep ?? '');
    if (parentDelta !== 0) {
      return parentDelta;
    }

    const nameDelta = (left.name ?? '').localeCompare(right.name ?? '');
    if (nameDelta !== 0) {
      return nameDelta;
    }

    return (left.xml_index ?? 0) - (right.xml_index ?? 0);
  });

  return ordered.map((step, index) => ({
    ...step,
    effective_order: {
      index: index + 1,
      basis: 'sequence_then_parent_then_name_then_xml_index',
      uncertainty: 'metadata ordering only; runtime execution semantics remain source-bounded',
    },
  }));
}

export const compute_effective_order = computeEffectiveOrder;
