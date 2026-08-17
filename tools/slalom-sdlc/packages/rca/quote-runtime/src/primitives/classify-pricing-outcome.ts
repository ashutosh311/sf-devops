import type { EvidenceItem } from '../contracts/evidence';
import type { JsonValue } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import {
  executeCapturePostPstEvidence,
  type CapturePostPstEvidencePrimitiveResult,
  type CapturePostPstEvidenceResult,
  type CapturePostPstLineEvidencePacket,
  type ExecuteCapturePostPstEvidenceInput
} from './capture-post-pst-evidence';
import type { InspectPricingWaterfallWaterfallElement } from './inspect-pricing-waterfall';

export const PRICING_OUTCOME_CLASSES = [
  'landed_and_survived',
  'landed_but_overwritten_before_persistence',
  'landed_but_not_reached_at_runtime',
  'runtime_effect_ambiguous_needs_user_intent',
  'blocked_by_tooling_or_evidence_gap'
] as const;

export type PricingOutcomeClass = (typeof PRICING_OUTCOME_CLASSES)[number];
export type PricingOutcomeProofStatus = 'proven' | 'hypothesis_level';
export type PricingOutcomeMetadataProofState = 'verified' | 'not_verified';
export type PricingOutcomeNextAction =
  | 'accept_success'
  | 'retarget_downstream_writer'
  | 'ask_user_to_clarify_intent'
  | 'investigate_runtime_path'
  | 'stop_for_tooling_or_evidence_gap';

export type PricingOutputFamily =
  | 'net_total_family'
  | 'net_unit_price_family'
  | 'usage_rate_card_family'
  | 'usage_rate_adjustment_family'
  | 'usage_grant_family'
  | 'usage_policy_family'
  | 'partial_usage_rating_family'
  | 'unknown';

export type PricingOutcomeWriterSummary = {
  sequence: number;
  name: string | null;
  writes: string[];
  normalized_families: PricingOutputFamily[];
};

export type PricingOutcomeLineClassification = {
  requested_line_id: string;
  resolved_line_id: string | null;
  transport_capture_status: CapturePostPstLineEvidencePacket['capture_status'];
  outcome_class: PricingOutcomeClass;
  proof_status: PricingOutcomeProofStatus;
  output_family_under_test: PricingOutputFamily | null;
  target_step_hint: string | null;
  likely_target_writer: PricingOutcomeWriterSummary | null;
  likely_winning_writer: PricingOutcomeWriterSummary | null;
  recommended_next_action: PricingOutcomeNextAction;
  classification_basis: {
    runtime_execution_summary: string[];
    persisted_outcome_summary: string[];
    overwrite_summary: string[];
    unresolved_ambiguities: string[];
  };
};

export type ClassifyPricingOutcomeResult = {
  requested_effect: string;
  metadata_proof_state: PricingOutcomeMetadataProofState;
  output_family_under_test: PricingOutputFamily | null;
  target_step_hint: string | null;
  outcome_class: PricingOutcomeClass;
  proof_status: PricingOutcomeProofStatus;
  recommended_next_action: PricingOutcomeNextAction;
  classification_basis: {
    runtime_execution_summary: string[];
    persisted_outcome_summary: string[];
    overwrite_summary: string[];
    unresolved_ambiguities: string[];
  };
  line_classifications: PricingOutcomeLineClassification[];
  evidence_packet: CapturePostPstEvidenceResult;
  recommended_next_commands: string[];
};

export type ClassifyPricingOutcomePrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'partial' | 'no_match' | 'unsupported' | 'error'>;
  result: ClassifyPricingOutcomeResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type ExecuteClassifyPricingOutcomeInput = {
  orgAlias: string;
  quoteId: string;
  lineIds: string[];
  expectedChange: string;
  metadataProofState?: PricingOutcomeMetadataProofState;
  outputFamilyHint?: string;
  targetStepHint?: string;
  includeAdjustments?: boolean;
  includeLineDetail?: boolean;
  includeUsageRating?: boolean;
  timeoutMs?: number;
  executeCapturePostPstEvidence?: (
    input: ExecuteCapturePostPstEvidenceInput
  ) => Promise<CapturePostPstEvidencePrimitiveResult>;
};

type AggregatePricingOutcome = Omit<
  ClassifyPricingOutcomeResult,
  'requested_effect' | 'metadata_proof_state' | 'line_classifications' | 'evidence_packet' | 'recommended_next_commands'
>;

export async function executeClassifyPricingOutcome(
  input: ExecuteClassifyPricingOutcomeInput
): Promise<ClassifyPricingOutcomePrimitiveResult> {
  const runCapture = input.executeCapturePostPstEvidence ?? executeCapturePostPstEvidence;
  const evidenceCapture = await runCapture({
    orgAlias: input.orgAlias,
    quoteId: input.quoteId,
    lineIds: input.lineIds,
    includeAdjustments: input.includeAdjustments,
    includeLineDetail: input.includeLineDetail,
    includeUsageRating: input.includeUsageRating,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  const metadataProofState = input.metadataProofState ?? 'not_verified';
  const lineClassifications = evidenceCapture.result.line_evidence_packets.map((packet) =>
    applyMetadataProofStateToLineClassification(
      classifyLine(packet, input.outputFamilyHint ?? null, input.targetStepHint ?? null),
      metadataProofState
    )
  );
  const aggregate = applyMetadataProofState(
    aggregateLineClassifications(lineClassifications, input.outputFamilyHint ?? null, input.targetStepHint ?? null),
    metadataProofState
  );
  const recommendedNextCommands = dedupeStrings([
    ...buildRecommendedNextCommands(aggregate.recommended_next_action),
    ...evidenceCapture.result.recommended_next_commands
  ]);

  return {
    status: evidenceCapture.status,
    result: {
      requested_effect: input.expectedChange.trim(),
      metadata_proof_state: metadataProofState,
      output_family_under_test: aggregate.output_family_under_test,
      target_step_hint: normalizeText(input.targetStepHint),
      outcome_class: aggregate.outcome_class,
      proof_status: aggregate.proof_status,
      recommended_next_action: aggregate.recommended_next_action,
      classification_basis: aggregate.classification_basis,
      line_classifications: lineClassifications,
      evidence_packet: evidenceCapture.result,
      recommended_next_commands: recommendedNextCommands
    },
    warnings: evidenceCapture.warnings,
    errors: evidenceCapture.errors,
    evidence: buildEvidence(evidenceCapture, aggregate)
  };
}

function classifyLine(
  packet: CapturePostPstLineEvidencePacket,
  outputFamilyHint: string | null,
  targetStepHint: string | null
): PricingOutcomeLineClassification {
  const runtimeExecutionSummary: string[] = [];
  const persistedOutcomeSummary: string[] = [];
  const overwriteSummary: string[] = [];
  const unresolvedAmbiguities: string[] = [];

  const normalizedHint = normalizeOutputFamilyHint(outputFamilyHint);
  const packetOutputFamilies = collectPacketOutputFamilies(packet);
  const outputFamily = pickOutputFamily(normalizedHint, packetOutputFamilies);

  if (packet.capture_status === 'no_match') {
    return buildLineClassification(packet, {
      outcome_class: 'blocked_by_tooling_or_evidence_gap',
      proof_status: 'proven',
      output_family_under_test: outputFamily,
      target_step_hint: normalizeText(targetStepHint),
      likely_target_writer: null,
      likely_winning_writer: null,
      recommended_next_action: 'stop_for_tooling_or_evidence_gap',
      classification_basis: {
        runtime_execution_summary: [`Requested line '${packet.requested_line_id}' did not resolve to a persisted line snapshot.`],
        persisted_outcome_summary: ['No persisted line state was available for classification.'],
        overwrite_summary: [],
        unresolved_ambiguities: ['Capture stopped before runtime evidence could be classified.']
      }
    });
  }

  if (packet.capture_status === 'error' || packet.waterfall === null) {
    return buildLineClassification(packet, {
      outcome_class: 'blocked_by_tooling_or_evidence_gap',
      proof_status: 'proven',
      output_family_under_test: outputFamily,
      target_step_hint: normalizeText(targetStepHint),
      likely_target_writer: null,
      likely_winning_writer: null,
      recommended_next_action: 'stop_for_tooling_or_evidence_gap',
      classification_basis: {
        runtime_execution_summary: ['Mandatory runtime capture did not complete through the waterfall lane.'],
        persisted_outcome_summary: [describePersistedFamily(packet, outputFamily)],
        overwrite_summary: [],
        unresolved_ambiguities: ['Without a waterfall payload, this closeout lane cannot prove survivability or overwrite behavior honestly.']
      }
    });
  }

  if (packet.capture_status === 'partial') {
    unresolvedAmbiguities.push('Evidence capture for this line was partial, so overwrite/survivability claims stay bounded by missing proof layers.');
  }

  if (outputFamily === null) {
    runtimeExecutionSummary.push('The waterfall payload did not expose one stable output family under test.');
    persistedOutcomeSummary.push(describePersistedFamily(packet, null));
    overwriteSummary.push('No confident same-output-family interpretation was possible from the available runtime writes.');
    unresolvedAmbiguities.push('Provide --output-family when the intended persistence family is known, or narrow to the exact target step.');
    return buildLineClassification(packet, {
      outcome_class: 'runtime_effect_ambiguous_needs_user_intent',
      proof_status: 'proven',
      output_family_under_test: null,
      target_step_hint: normalizeText(targetStepHint),
      likely_target_writer: null,
      likely_winning_writer: null,
      recommended_next_action: 'ask_user_to_clarify_intent',
      classification_basis: {
        runtime_execution_summary: runtimeExecutionSummary,
        persisted_outcome_summary: persistedOutcomeSummary,
        overwrite_summary: overwriteSummary,
        unresolved_ambiguities: unresolvedAmbiguities
      }
    });
  }

  if (isUsageOutputFamily(outputFamily)) {
    const usageStatus = artifactStatusForUsageFamily(packet, outputFamily);
    persistedOutcomeSummary.push(describePersistedFamily(packet, outputFamily));
    runtimeExecutionSummary.push(
      usageStatus === 'ok'
        ? `Persisted ${describeOutputFamily(outputFamily)} artifacts were captured for the line.`
        : `Persisted ${describeOutputFamily(outputFamily)} artifacts were not proven for the line; status=${usageStatus}.`
    );

    if (usageStatus === 'ok') {
      overwriteSummary.push('Usage/rate artifact persistence was proven by quote-side records rather than pricing waterfall numeric writers.');
      return buildLineClassification(packet, {
        outcome_class: 'landed_and_survived',
        proof_status: 'proven',
        output_family_under_test: outputFamily,
        target_step_hint: normalizeText(targetStepHint),
        likely_target_writer: null,
        likely_winning_writer: null,
        recommended_next_action: 'accept_success',
        classification_basis: {
          runtime_execution_summary: runtimeExecutionSummary,
          persisted_outcome_summary: persistedOutcomeSummary,
          overwrite_summary: overwriteSummary,
          unresolved_ambiguities: unresolvedAmbiguities
        }
      });
    }

    unresolvedAmbiguities.push('Usage/rate catalog or transport may be ready, but quote-side usage/rate artifact persistence is absent or uncaptured.');
    return buildLineClassification(packet, {
      outcome_class: 'blocked_by_tooling_or_evidence_gap',
      proof_status: usageStatus === 'not_requested' ? 'hypothesis_level' : 'proven',
      output_family_under_test: outputFamily,
      target_step_hint: normalizeText(targetStepHint),
      likely_target_writer: null,
      likely_winning_writer: null,
      recommended_next_action: usageStatus === 'not_requested' ? 'stop_for_tooling_or_evidence_gap' : 'investigate_runtime_path',
      classification_basis: {
        runtime_execution_summary: runtimeExecutionSummary,
        persisted_outcome_summary: persistedOutcomeSummary,
        overwrite_summary: overwriteSummary,
        unresolved_ambiguities: unresolvedAmbiguities
      }
    });
  }

  const allWaterfallElements = packet.waterfall?.normalized_elements ?? [];
  const familyWriters = collectFamilyWriters(packet, outputFamily);
  const targetElements = matchTargetWriters(allWaterfallElements, targetStepHint);
  const targetWriters = matchTargetWriters(familyWriters, targetStepHint);
  const persistedValue = pickPersistedFamilyValue(packet, outputFamily);
  const targetElement = targetElements[0] ?? null;
  const targetWriter = targetWriters[0] ?? targetElement;
  const finalWriter = familyWriters[familyWriters.length - 1] ?? null;
  const targetMatchesPersisted = targetWriter !== null && valuesCompatible(extractWriterValues(targetWriter, outputFamily), persistedValue);
  const finalMatchesPersisted = finalWriter !== null && valuesCompatible(extractWriterValues(finalWriter, outputFamily), persistedValue);
  const targetProducesRuntimeDiscriminator = targetElement !== null && targetElementProducesRuntimeDiscriminator(targetElement, persistedValue);

  runtimeExecutionSummary.push(
    `Observed ${familyWriters.length} runtime writer${familyWriters.length === 1 ? '' : 's'} for ${describeOutputFamily(outputFamily)} in the fetched waterfall.`
  );
  persistedOutcomeSummary.push(describePersistedFamily(packet, outputFamily));

  if (targetStepHint !== null && targetStepHint.trim() !== '') {
    if (targetElements.length === 0) {
      runtimeExecutionSummary.push(`No waterfall element name matched target-step hint '${targetStepHint.trim()}' in the fetched waterfall.`);
      overwriteSummary.push('Other same-family writers may have executed, but the hinted target step itself was not visible in the runtime path.');
      return buildLineClassification(packet, {
        outcome_class: 'landed_but_not_reached_at_runtime',
        proof_status: 'proven',
        output_family_under_test: outputFamily,
        target_step_hint: normalizeText(targetStepHint),
        likely_target_writer: null,
        likely_winning_writer: finalWriter ? toWriterSummary(finalWriter, outputFamily) : null,
        recommended_next_action: 'investigate_runtime_path',
        classification_basis: {
          runtime_execution_summary: runtimeExecutionSummary,
          persisted_outcome_summary: persistedOutcomeSummary,
          overwrite_summary: overwriteSummary,
          unresolved_ambiguities: unresolvedAmbiguities
        }
      });
    }

    if (targetElements.length > 1) {
      overwriteSummary.push(`Multiple waterfall elements matched target-step hint '${targetStepHint.trim()}'.`);
      unresolvedAmbiguities.push('The hint did not isolate one executable writer, so the closeout lane should not guess which target the operator meant.');
      return buildLineClassification(packet, {
        outcome_class: 'runtime_effect_ambiguous_needs_user_intent',
        proof_status: 'proven',
        output_family_under_test: outputFamily,
        target_step_hint: normalizeText(targetStepHint),
        likely_target_writer: null,
        likely_winning_writer: finalWriter ? toWriterSummary(finalWriter, outputFamily) : null,
        recommended_next_action: 'ask_user_to_clarify_intent',
        classification_basis: {
          runtime_execution_summary: runtimeExecutionSummary,
          persisted_outcome_summary: persistedOutcomeSummary,
          overwrite_summary: overwriteSummary,
          unresolved_ambiguities: unresolvedAmbiguities
        }
      });
    }

    if (targetWriters.length === 0 && targetElement !== null) {
      runtimeExecutionSummary.push(`Waterfall element '${describeWriter(targetElement)}' matched target-step hint '${targetStepHint.trim()}', but its live outputs did not expose a direct ${describeOutputFamily(outputFamily)} write.`);

      if (finalWriter !== null && finalWriter.sequence > targetElement.sequence) {
        overwriteSummary.push(`Later same-family writer '${describeWriter(finalWriter)}' ran after target step '${describeWriter(targetElement)}'.`);
        if (targetProducesRuntimeDiscriminator && finalMatchesPersisted === true) {
          overwriteSummary.push('The target step emitted a distinct runtime discriminator that did not survive into the persisted family values, while the later writer aligns with persistence.');
          return buildLineClassification(packet, {
            outcome_class: 'landed_but_overwritten_before_persistence',
            proof_status: 'hypothesis_level',
            output_family_under_test: outputFamily,
            target_step_hint: normalizeText(targetStepHint),
            likely_target_writer: toWriterSummary(targetElement, outputFamily),
            likely_winning_writer: toWriterSummary(finalWriter, outputFamily),
            recommended_next_action: 'retarget_downstream_writer',
            classification_basis: {
              runtime_execution_summary: runtimeExecutionSummary,
              persisted_outcome_summary: persistedOutcomeSummary,
              overwrite_summary: overwriteSummary,
              unresolved_ambiguities: unresolvedAmbiguities
            }
          });
        }

        unresolvedAmbiguities.push('The target step was visible, but it did not expose a direct same-family write that would prove the persisted overwrite path by itself.');
        return buildLineClassification(packet, {
          outcome_class: 'landed_but_overwritten_before_persistence',
          proof_status: 'hypothesis_level',
          output_family_under_test: outputFamily,
          target_step_hint: normalizeText(targetStepHint),
          likely_target_writer: toWriterSummary(targetElement, outputFamily),
          likely_winning_writer: toWriterSummary(finalWriter, outputFamily),
          recommended_next_action: 'retarget_downstream_writer',
          classification_basis: {
            runtime_execution_summary: runtimeExecutionSummary,
            persisted_outcome_summary: persistedOutcomeSummary,
            overwrite_summary: overwriteSummary,
            unresolved_ambiguities: unresolvedAmbiguities
          }
        });
      }

      unresolvedAmbiguities.push('The target step executed, but no downstream same-family writer was visible after it in the fetched waterfall.');
      return buildLineClassification(packet, {
        outcome_class: 'runtime_effect_ambiguous_needs_user_intent',
        proof_status: 'proven',
        output_family_under_test: outputFamily,
        target_step_hint: normalizeText(targetStepHint),
        likely_target_writer: toWriterSummary(targetElement, outputFamily),
        likely_winning_writer: finalWriter ? toWriterSummary(finalWriter, outputFamily) : null,
        recommended_next_action: 'ask_user_to_clarify_intent',
        classification_basis: {
          runtime_execution_summary: runtimeExecutionSummary,
          persisted_outcome_summary: persistedOutcomeSummary,
          overwrite_summary: overwriteSummary,
          unresolved_ambiguities: unresolvedAmbiguities
        }
      });
    }

    if (familyWriters.length > 1 && finalWriter !== null && targetWriter !== null && finalWriter.sequence > targetWriter.sequence) {
      overwriteSummary.push(`Later same-family writer '${describeWriter(finalWriter)}' ran after target writer '${describeWriter(targetWriter)}'.`);
      if (targetMatchesPersisted === false && finalMatchesPersisted === true) {
        overwriteSummary.push('Persisted family values align with the later writer more strongly than with the target writer.');
        return buildLineClassification(packet, {
          outcome_class: 'landed_but_overwritten_before_persistence',
          proof_status: 'proven',
          output_family_under_test: outputFamily,
          target_step_hint: normalizeText(targetStepHint),
          likely_target_writer: toWriterSummary(targetWriter, outputFamily),
          likely_winning_writer: toWriterSummary(finalWriter, outputFamily),
          recommended_next_action: 'retarget_downstream_writer',
          classification_basis: {
            runtime_execution_summary: runtimeExecutionSummary,
            persisted_outcome_summary: persistedOutcomeSummary,
            overwrite_summary: overwriteSummary,
            unresolved_ambiguities: unresolvedAmbiguities
          }
        });
      }

      unresolvedAmbiguities.push('A later same-family writer exists, but the persisted values did not tie cleanly to only one writer.');
      return buildLineClassification(packet, {
        outcome_class: 'landed_but_overwritten_before_persistence',
        proof_status: 'hypothesis_level',
        output_family_under_test: outputFamily,
        target_step_hint: normalizeText(targetStepHint),
        likely_target_writer: toWriterSummary(targetWriter, outputFamily),
        likely_winning_writer: toWriterSummary(finalWriter, outputFamily),
        recommended_next_action: 'retarget_downstream_writer',
        classification_basis: {
          runtime_execution_summary: runtimeExecutionSummary,
          persisted_outcome_summary: persistedOutcomeSummary,
          overwrite_summary: overwriteSummary,
          unresolved_ambiguities: unresolvedAmbiguities
        }
      });
    }

    if (targetMatchesPersisted === true && familyWriters.length === 1) {
      overwriteSummary.push('No later same-family writer appeared after the target writer.');
      return buildLineClassification(packet, {
        outcome_class: 'landed_and_survived',
        proof_status: 'proven',
        output_family_under_test: outputFamily,
        target_step_hint: normalizeText(targetStepHint),
        likely_target_writer: toWriterSummary(targetWriter, outputFamily),
        likely_winning_writer: toWriterSummary(targetWriter, outputFamily),
        recommended_next_action: 'accept_success',
        classification_basis: {
          runtime_execution_summary: runtimeExecutionSummary,
          persisted_outcome_summary: persistedOutcomeSummary,
          overwrite_summary: overwriteSummary,
          unresolved_ambiguities: unresolvedAmbiguities
        }
      });
    }

    if (targetMatchesPersisted === true) {
      overwriteSummary.push('The target writer matches persisted values, but additional same-family writers still exist downstream.');
      unresolvedAmbiguities.push('Later writers may have preserved the same value, so survivability stays hypothesis-level rather than proven.');
      return buildLineClassification(packet, {
        outcome_class: 'landed_and_survived',
        proof_status: 'hypothesis_level',
        output_family_under_test: outputFamily,
        target_step_hint: normalizeText(targetStepHint),
        likely_target_writer: toWriterSummary(targetWriter, outputFamily),
        likely_winning_writer: finalWriter ? toWriterSummary(finalWriter, outputFamily) : toWriterSummary(targetWriter, outputFamily),
        recommended_next_action: 'accept_success',
        classification_basis: {
          runtime_execution_summary: runtimeExecutionSummary,
          persisted_outcome_summary: persistedOutcomeSummary,
          overwrite_summary: overwriteSummary,
          unresolved_ambiguities: unresolvedAmbiguities
        }
      });
    }
  }

  if (familyWriters.length === 1 && finalMatchesPersisted === true && finalWriter !== null) {
    overwriteSummary.push('Only one same-family writer was visible and its output matches the persisted family values.');
    return buildLineClassification(packet, {
      outcome_class: 'landed_and_survived',
      proof_status: normalizedHint === null ? 'hypothesis_level' : 'proven',
      output_family_under_test: outputFamily,
      target_step_hint: normalizeText(targetStepHint),
      likely_target_writer: finalWriter ? toWriterSummary(finalWriter, outputFamily) : null,
      likely_winning_writer: finalWriter ? toWriterSummary(finalWriter, outputFamily) : null,
      recommended_next_action: 'accept_success',
      classification_basis: {
        runtime_execution_summary: runtimeExecutionSummary,
        persisted_outcome_summary: persistedOutcomeSummary,
        overwrite_summary: overwriteSummary,
        unresolved_ambiguities: normalizedHint === null
          ? dedupeStrings(unresolvedAmbiguities.concat('Output family was inferred from runtime writes rather than explicitly supplied by the operator.'))
          : unresolvedAmbiguities
      }
    });
  }

  if (familyWriters.length > 1) {
    overwriteSummary.push('Multiple same-output-family writers were visible, but no target-step hint singled out the intended writer.');
    unresolvedAmbiguities.push('Supply --target-step when the operator intends a named pricing element, or confirm that final persisted outcome is the only goal.');
    return buildLineClassification(packet, {
      outcome_class: 'runtime_effect_ambiguous_needs_user_intent',
      proof_status: 'proven',
      output_family_under_test: outputFamily,
      target_step_hint: normalizeText(targetStepHint),
      likely_target_writer: null,
      likely_winning_writer: finalWriter ? toWriterSummary(finalWriter, outputFamily) : null,
      recommended_next_action: 'ask_user_to_clarify_intent',
      classification_basis: {
        runtime_execution_summary: runtimeExecutionSummary,
        persisted_outcome_summary: persistedOutcomeSummary,
        overwrite_summary: overwriteSummary,
        unresolved_ambiguities: unresolvedAmbiguities
      }
    });
  }

  overwriteSummary.push('The runtime evidence did not expose enough same-family writer detail to prove survivability or overwrite cleanly.');
  unresolvedAmbiguities.push('Use inspect-pricing-waterfall for deeper single-line interpretation or add an explicit output-family hint.');
  return buildLineClassification(packet, {
    outcome_class: 'blocked_by_tooling_or_evidence_gap',
    proof_status: 'hypothesis_level',
    output_family_under_test: outputFamily,
    target_step_hint: normalizeText(targetStepHint),
    likely_target_writer: finalWriter ? toWriterSummary(finalWriter, outputFamily) : null,
    likely_winning_writer: finalWriter ? toWriterSummary(finalWriter, outputFamily) : null,
    recommended_next_action: 'stop_for_tooling_or_evidence_gap',
    classification_basis: {
      runtime_execution_summary: runtimeExecutionSummary,
      persisted_outcome_summary: persistedOutcomeSummary,
      overwrite_summary: overwriteSummary,
      unresolved_ambiguities: unresolvedAmbiguities
    }
  });
}

function aggregateLineClassifications(
  lines: PricingOutcomeLineClassification[],
  outputFamilyHint: string | null,
  targetStepHint: string | null
): AggregatePricingOutcome {
  if (lines.length === 0) {
    return {
      output_family_under_test: normalizeOutputFamilyHint(outputFamilyHint),
      target_step_hint: normalizeText(targetStepHint),
      outcome_class: 'blocked_by_tooling_or_evidence_gap',
      proof_status: 'proven',
      recommended_next_action: 'stop_for_tooling_or_evidence_gap',
      classification_basis: {
        runtime_execution_summary: ['No requested lines were available for outcome classification.'],
        persisted_outcome_summary: ['No persisted outcome proof was collected.'],
        overwrite_summary: [],
        unresolved_ambiguities: ['Provide at least one line id to classify.']
      }
    };
  }

  const distinctClasses = Array.from(new Set(lines.map((line) => line.outcome_class)));
  const distinctFamilies = Array.from(new Set(lines.map((line) => line.output_family_under_test).filter((value): value is PricingOutputFamily => value !== null)));

  if (distinctClasses.length === 1) {
    const first = lines[0];
    return {
      output_family_under_test: distinctFamilies[0] ?? normalizeOutputFamilyHint(outputFamilyHint),
      target_step_hint: normalizeText(targetStepHint),
      outcome_class: first.outcome_class,
      proof_status: lines.some((line) => line.proof_status === 'hypothesis_level') ? 'hypothesis_level' : 'proven',
      recommended_next_action: first.recommended_next_action,
      classification_basis: mergeClassificationBasis(lines)
    };
  }

  const mergedBasis = mergeClassificationBasis(lines);
  mergedBasis.unresolved_ambiguities = dedupeStrings([
    ...mergedBasis.unresolved_ambiguities,
    `Requested lines produced multiple outcome classes (${distinctClasses.join(', ')}), so one top-level closeout would over-compress the evidence.`
  ]);

  return {
    output_family_under_test: distinctFamilies.length === 1 ? distinctFamilies[0] : normalizeOutputFamilyHint(outputFamilyHint),
    target_step_hint: normalizeText(targetStepHint),
    outcome_class: 'runtime_effect_ambiguous_needs_user_intent',
    proof_status: 'proven',
    recommended_next_action: 'ask_user_to_clarify_intent',
    classification_basis: mergedBasis
  };
}

function applyMetadataProofStateToLineClassification(
  line: PricingOutcomeLineClassification,
  metadataProofState: PricingOutcomeMetadataProofState
): PricingOutcomeLineClassification {
  if (metadataProofState === 'verified' || !line.outcome_class.startsWith('landed_')) {
    return line;
  }

  return {
    ...line,
    proof_status: 'hypothesis_level',
    recommended_next_action: 'stop_for_tooling_or_evidence_gap',
    classification_basis: {
      ...line.classification_basis,
      unresolved_ambiguities: dedupeStrings([
        ...line.classification_basis.unresolved_ambiguities,
        'Metadata landing was not independently verified for this line, so landed_* closeout remains hypothesis-level.'
      ])
    }
  };
}

function buildRecommendedNextCommands(action: PricingOutcomeNextAction): string[] {
  switch (action) {
    case 'accept_success':
      return [];
    case 'retarget_downstream_writer':
      return ['inspect-pricing-waterfall', 'inspect-rlm-context'];
    case 'ask_user_to_clarify_intent':
      return ['capture-post-pst-evidence', 'inspect-pricing-waterfall'];
    case 'investigate_runtime_path':
      return ['inspect-pricing-waterfall', 'capture-post-pst-evidence'];
    case 'stop_for_tooling_or_evidence_gap':
      return ['inspect-pricing-waterfall', 'inspect-rlm-context', 'doctor'];
  }
}

function applyMetadataProofState(
  aggregate: AggregatePricingOutcome,
  metadataProofState: PricingOutcomeMetadataProofState
): AggregatePricingOutcome {
  if (metadataProofState === 'verified') {
    return aggregate;
  }

  if (!aggregate.outcome_class.startsWith('landed_')) {
    return aggregate;
  }

  const unresolved = dedupeStrings([
    ...aggregate.classification_basis.unresolved_ambiguities,
    'Metadata landing was not independently verified by this command, so landed_* outcome claims remain hypothesis-level even when runtime/persisted evidence is strong.'
  ]);

  return {
    ...aggregate,
    proof_status: 'hypothesis_level',
    recommended_next_action: 'stop_for_tooling_or_evidence_gap',
    classification_basis: {
      ...aggregate.classification_basis,
      unresolved_ambiguities: unresolved
    }
  };
}

function buildEvidence(
  evidenceCapture: CapturePostPstEvidencePrimitiveResult,
  aggregate: AggregatePricingOutcome
): EvidenceItem[] {
  return dedupeEvidenceItems([
    ...evidenceCapture.evidence,
    {
      claim: `Classified pricing outcome as '${aggregate.outcome_class}' while preserving transport status '${evidenceCapture.status}'.`,
      evidence_level: aggregate.proof_status === 'proven' ? 'org_proven' : 'inferred',
      proof_source: ['capture-post-pst-evidence', 'core-pricing waterfall', 'persisted line snapshot'],
      limitations: aggregate.proof_status === 'proven'
        ? 'Classification is limited to the captured quote/line scope and the output-family interpretation recorded in classification_basis.'
        : 'Classification remains hypothesis-level because the captured evidence did not isolate one conclusive same-family winner.',
      source_refs: []
    }
  ]);
}

function mergeClassificationBasis(lines: PricingOutcomeLineClassification[]): ClassifyPricingOutcomeResult['classification_basis'] {
  return {
    runtime_execution_summary: dedupeStrings(lines.flatMap((line) => line.classification_basis.runtime_execution_summary)),
    persisted_outcome_summary: dedupeStrings(lines.flatMap((line) => line.classification_basis.persisted_outcome_summary)),
    overwrite_summary: dedupeStrings(lines.flatMap((line) => line.classification_basis.overwrite_summary)),
    unresolved_ambiguities: dedupeStrings(lines.flatMap((line) => line.classification_basis.unresolved_ambiguities))
  };
}

function buildLineClassification(
  packet: CapturePostPstLineEvidencePacket,
  fields: Omit<PricingOutcomeLineClassification, 'requested_line_id' | 'resolved_line_id' | 'transport_capture_status'>
): PricingOutcomeLineClassification {
  return {
    requested_line_id: packet.requested_line_id,
    resolved_line_id: packet.resolved_line_id,
    transport_capture_status: packet.capture_status,
    ...fields
  };
}

function collectPacketOutputFamilies(packet: CapturePostPstLineEvidencePacket): PricingOutputFamily[] {
  const targets = packet.waterfall?.summary.output_targets ?? [];
  const usageFamilies: PricingOutputFamily[] = [];
  if (packet.artifact_statuses.rate_card_entries === 'ok') {
    usageFamilies.push('usage_rate_card_family');
  }
  if (packet.artifact_statuses.rate_adjustments === 'ok') {
    usageFamilies.push('usage_rate_adjustment_family');
  }
  if (packet.artifact_statuses.usage_grants === 'ok') {
    usageFamilies.push('usage_grant_family');
  }
  if (packet.artifact_statuses.usage_policies === 'ok') {
    usageFamilies.push('usage_policy_family');
  }
  if (
    ['not_found', 'unsupported'].includes(packet.artifact_statuses.rate_card_entries)
    || ['not_found', 'unsupported'].includes(packet.artifact_statuses.usage_grants)
    || ['not_found', 'unsupported'].includes(packet.artifact_statuses.usage_policies)
  ) {
    usageFamilies.push('partial_usage_rating_family');
  }
  return dedupeFamilies(targets.map((target) => normalizeWriteTarget(target)).concat(usageFamilies));
}

function pickOutputFamily(
  normalizedHint: PricingOutputFamily | null,
  packetOutputFamilies: PricingOutputFamily[]
): PricingOutputFamily | null {
  if (normalizedHint !== null && normalizedHint !== 'unknown') {
    return normalizedHint;
  }

  const meaningfulFamilies = packetOutputFamilies.filter((family) => family !== 'unknown');
  return meaningfulFamilies.length === 1 ? meaningfulFamilies[0] : null;
}

function collectFamilyWriters(
  packet: CapturePostPstLineEvidencePacket,
  family: PricingOutputFamily
): InspectPricingWaterfallWaterfallElement[] {
  return (packet.waterfall?.normalized_elements ?? []).filter((element) =>
    element.writes.some((write) => normalizeWriteTarget(write) === family)
  );
}

function matchTargetWriters(
  writers: InspectPricingWaterfallWaterfallElement[],
  targetStepHint: string | null
): InspectPricingWaterfallWaterfallElement[] {
  const normalizedHint = normalizeText(targetStepHint)?.toLowerCase();
  if (!normalizedHint) {
    return [];
  }

  return writers.filter((writer) => (writer.name ?? '').trim().toLowerCase().includes(normalizedHint));
}

function normalizeOutputFamilyHint(value: string | null | undefined): PricingOutputFamily | null {
  const normalized = normalizeText(value);
  if (normalized === null) {
    return null;
  }

  const family = normalizeWriteTarget(normalized);
  return family === 'unknown' ? null : family;
}

function normalizeWriteTarget(value: string): PricingOutputFamily {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['itemnettotalprice', 'subtotal', 'nettotalprice', 'totallineamount'].includes(normalized)) {
    return 'net_total_family';
  }
  if (['netunitprice', 'salesprice'].includes(normalized)) {
    return 'net_unit_price_family';
  }
  if (['usageratecardfamily', 'ratecard', 'ratecardentry', 'quotelineratecardentry'].includes(normalized)) {
    return 'usage_rate_card_family';
  }
  if (['usagerateadjustmentfamily', 'rateadjustment', 'rateadjustments', 'quotelinerateadjustment'].includes(normalized)) {
    return 'usage_rate_adjustment_family';
  }
  if (['usagegrantfamily', 'usagegrant', 'usagegrants', 'quotlineitmusrsrcgrant'].includes(normalized)) {
    return 'usage_grant_family';
  }
  if (['usagepolicyfamily', 'usagepolicy', 'usagepolicies', 'quotlineitmusersrcplcy'].includes(normalized)) {
    return 'usage_policy_family';
  }
  if (['partialusageratingfamily', 'partialusagerating', 'usagerating'].includes(normalized)) {
    return 'partial_usage_rating_family';
  }
  return 'unknown';
}

function extractWriterValues(
  writer: InspectPricingWaterfallWaterfallElement,
  family: PricingOutputFamily
): number[] {
  return dedupeNumbers(writer.outputs.flatMap((entry) => extractValueForFamily(entry, family)));
}

function targetElementProducesRuntimeDiscriminator(
  writer: InspectPricingWaterfallWaterfallElement,
  persistedValue: number | null
): boolean {
  if (persistedValue === null) {
    return false;
  }

  const discriminatorTargets = new Set(['outputvariable', 'formulasection0output']);
  for (const entry of writer.outputs) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, JsonValue>;
    const rawTarget = record.target ?? record.name ?? record.fieldName ?? record.field;
    if (typeof rawTarget !== 'string') {
      continue;
    }

    const normalizedTarget = rawTarget.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!discriminatorTargets.has(normalizedTarget) && !/^formulasection\d+output$/.test(normalizedTarget)) {
      continue;
    }

    const outputValues = [record.value, record.outputValue, record.amount, record.numericValue].flatMap((candidate) => toNumericValues(candidate));
    if (outputValues.some((value) => Math.abs(value - persistedValue) >= 0.000001)) {
      return true;
    }
  }

  return false;
}

function extractValueForFamily(entry: JsonValue, family: PricingOutputFamily): number[] {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return [];
  }

  const record = entry as Record<string, JsonValue>;
  const target = record.target ?? record.name ?? record.fieldName ?? record.field;
  if (typeof target !== 'string' || normalizeWriteTarget(target) !== family) {
    return [];
  }

  const candidates = [record.value, record.outputValue, record.amount, record.numericValue];
  return candidates.flatMap((candidate) => toNumericValues(candidate));
}

function pickPersistedFamilyValue(packet: CapturePostPstLineEvidencePacket, family: PricingOutputFamily): number | null {
  const line = packet.line_snapshot;
  if (!line) {
    return null;
  }

  const candidates = family === 'net_total_family'
    ? [line.NetTotalPrice, line.Subtotal, line.TotalLineAmount]
    : family === 'net_unit_price_family'
      ? [line.NetUnitPrice]
      : [];
  return candidates.flatMap((candidate) => toNumericValues(candidate))[0] ?? null;
}

function valuesCompatible(writerValues: number[], persistedValue: number | null): boolean {
  if (persistedValue === null || writerValues.length === 0) {
    return false;
  }

  return writerValues.some((value) => Math.abs(value - persistedValue) < 0.000001);
}

function describePersistedFamily(packet: CapturePostPstLineEvidencePacket, family: PricingOutputFamily | null): string {
  const line = packet.line_snapshot;
  if (line === null) {
    return 'No persisted line snapshot was available.';
  }

  if (family === 'net_total_family') {
    return `Persisted net-total-family values read back as NetTotalPrice=${formatScalar(line.NetTotalPrice)}, Subtotal=${formatScalar(line.Subtotal)}, TotalLineAmount=${formatScalar(line.TotalLineAmount)}.`;
  }
  if (family === 'net_unit_price_family') {
    return `Persisted net-unit-price-family values read back as NetUnitPrice=${formatScalar(line.NetUnitPrice)}.`;
  }
  if (family !== null && isUsageOutputFamily(family)) {
    const status = artifactStatusForUsageFamily(packet, family);
    return `Persisted ${describeOutputFamily(family)} artifact status is ${status}.`;
  }
  return 'Persisted line snapshot was available, but no single output family was selected for comparison.';
}

function describeOutputFamily(family: PricingOutputFamily): string {
  switch (family) {
    case 'net_total_family':
      return 'the net-total persistence family';
    case 'net_unit_price_family':
      return 'the net-unit-price family';
    case 'usage_rate_card_family':
      return 'the usage rate-card family';
    case 'usage_rate_adjustment_family':
      return 'the usage rate-adjustment family';
    case 'usage_grant_family':
      return 'the usage grant family';
    case 'usage_policy_family':
      return 'the usage policy family';
    case 'partial_usage_rating_family':
      return 'the partial usage-rating family';
    case 'unknown':
      return 'an unknown output family';
  }
}

function isUsageOutputFamily(family: PricingOutputFamily): boolean {
  return [
    'usage_rate_card_family',
    'usage_rate_adjustment_family',
    'usage_grant_family',
    'usage_policy_family',
    'partial_usage_rating_family'
  ].includes(family);
}

function artifactStatusForUsageFamily(
  packet: CapturePostPstLineEvidencePacket,
  family: PricingOutputFamily
): CapturePostPstLineEvidencePacket['artifact_statuses'][keyof CapturePostPstLineEvidencePacket['artifact_statuses']] {
  switch (family) {
    case 'usage_rate_card_family':
      return packet.artifact_statuses.rate_card_entries;
    case 'usage_rate_adjustment_family':
      return packet.artifact_statuses.rate_adjustments;
    case 'usage_grant_family':
      return packet.artifact_statuses.usage_grants;
    case 'usage_policy_family':
      return packet.artifact_statuses.usage_policies;
    case 'partial_usage_rating_family':
      return packet.artifact_statuses.rate_card_entries === 'ok'
        || packet.artifact_statuses.rate_adjustments === 'ok'
        || packet.artifact_statuses.usage_grants === 'ok'
        || packet.artifact_statuses.usage_policies === 'ok'
        ? 'ok'
        : 'not_found';
    default:
      return 'not_requested';
  }
}

function describeWriter(writer: InspectPricingWaterfallWaterfallElement): string {
  return writer.name ? `${writer.name}#${writer.sequence}` : `sequence ${writer.sequence}`;
}

function toWriterSummary(
  writer: InspectPricingWaterfallWaterfallElement,
  family: PricingOutputFamily
): PricingOutcomeWriterSummary {
  return {
    sequence: writer.sequence,
    name: writer.name,
    writes: [...writer.writes],
    normalized_families: dedupeFamilies(writer.writes.map((write) => normalizeWriteTarget(write)).concat(family))
  };
}

function dedupeFamilies(values: PricingOutputFamily[]): PricingOutputFamily[] {
  const seen = new Set<PricingOutputFamily>();
  const deduped: PricingOutputFamily[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

function dedupeNumbers(values: number[]): number[] {
  const seen = new Set<string>();
  const deduped: number[] = [];
  for (const value of values) {
    const key = String(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}

function toNumericValues(value: JsonValue): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [value];
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? [parsed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => toNumericValues(entry));
  }
  return [];
}

function formatScalar(value: JsonValue): string {
  return value === null ? 'null' : String(value);
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

function dedupeEvidenceItems(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  const deduped: EvidenceItem[] = [];
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}
