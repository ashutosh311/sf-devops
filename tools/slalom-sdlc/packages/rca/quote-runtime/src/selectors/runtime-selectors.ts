import { ALL_COMMAND_NAMES, type CommandName } from '../contracts/command-names';
import { normalizeOperationFamily, type OperationFamily } from '../contracts/operation-family';

export class SelectorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectorValidationError';
  }
}

export type RuntimeSelectorInput = {
  quote_id?: string | null | undefined;
  before_quote_id?: string | null | undefined;
  after_quote_id?: string | null | undefined;
  line_id?: readonly string[] | null | undefined;
  asset_id?: readonly string[] | null | undefined;
  symptom?: string | null | undefined;
  expected_change?: string | null | undefined;
  changed_artifact?: string | null | undefined;
  operation_family?: string | null | undefined;
  for_command?: string | null | undefined;
};

export type RuntimeSelectorBundle = {
  quote_id: string | null;
  before_quote_id: string | null;
  after_quote_id: string | null;
  line_ids: string[];
  asset_ids: string[];
  symptom: string | null;
  expected_change: string | null;
  changed_artifact: string | null;
  operation_family: OperationFamily | null;
  for_command: CommandName | null;
};

const SUPPORTED_COMMANDS_V1 = ALL_COMMAND_NAMES;

export function normalizeSelectors(input: RuntimeSelectorInput): RuntimeSelectorBundle {
  const quote_id = normalizeOptionalId(input.quote_id, 'quote-id');
  const before_quote_id = normalizeOptionalId(input.before_quote_id, 'before-quote-id');
  const after_quote_id = normalizeOptionalId(input.after_quote_id, 'after-quote-id');

  if (quote_id && (before_quote_id || after_quote_id)) {
    throw new SelectorValidationError('--quote-id must not be mixed with --before-quote-id/--after-quote-id in V1.');
  }

  return {
    quote_id,
    before_quote_id,
    after_quote_id,
    line_ids: normalizeRepeatableIds(input.line_id, 'line-id'),
    asset_ids: normalizeRepeatableIds(input.asset_id, 'asset-id'),
    symptom: normalizeOptionalText(input.symptom),
    expected_change: normalizeOptionalText(input.expected_change),
    changed_artifact: normalizeOptionalText(input.changed_artifact),
    operation_family: normalizeOperationFamilySelector(input.operation_family),
    for_command: normalizeKnownCommand(input.for_command)
  };
}

export function normalizeKnownCommand(command: string | null | undefined): CommandName | null {
  if (command == null) {
    return null;
  }

  const normalized = command.trim();

  if (!normalized) {
    throw new SelectorValidationError('Command name must not be empty.');
  }

  if (!isKnownCommand(normalized)) {
    throw new SelectorValidationError(
      `Unknown V1 command '${normalized}'. Expected one of ${SUPPORTED_COMMANDS_V1.join(', ')}.`
    );
  }

  return normalized;
}

export function normalizeOperationFamilySelector(value: string | null | undefined): OperationFamily | null {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new SelectorValidationError('operation_family must not be empty when provided.');
  }

  try {
    return normalizeOperationFamily(normalized);
  } catch {
    throw new SelectorValidationError(
      `Unsupported operation_family '${normalized}'. Expected one of pst_place, initiate_amendment, amendment, initiate_renewal, renewal, asset_add_to_renewal, add_asset.`
    );
  }
}

export function normalizeOptionalId(value: string | null | undefined, fieldName: string): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new SelectorValidationError(`--${fieldName} must not be empty when provided.`);
  }

  return normalized;
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new SelectorValidationError('Text selector values must not be blank when provided.');
  }

  return normalized;
}

export function normalizeRepeatableIds(
  values: readonly string[] | null | undefined,
  fieldName: string
): string[] {
  if (!values?.length) {
    return [];
  }

  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    const normalized = normalizeOptionalId(value, fieldName);

    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      ordered.push(normalized);
    }
  }

  return ordered;
}

function isKnownCommand(value: string): value is CommandName {
  return (SUPPORTED_COMMANDS_V1 as readonly string[]).includes(value);
}
