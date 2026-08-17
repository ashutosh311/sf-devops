export type CommandAvailability = 'supported' | 'unsupported';

export interface CommandInputDefinition {
  name: string;
  value_type: 'string' | 'path' | 'org_alias' | 'run_id' | 'evidence_id';
  description: string;
}

export interface CommandFlagDefinition {
  name: string;
  value_type: 'boolean' | 'string' | 'enum' | 'integer';
  required: boolean;
  default?: string | number | boolean;
  enum?: string[];
  description: string;
}

const FAIL_ON_STATUSES = ['error', 'unsupported', 'partial', 'warn', 'changed', 'no_match', 'no_change', 'ok'] as const;

export interface CommandListing {
  command_id: string;
  command: string;
  purpose: string;
  required_inputs: CommandInputDefinition[];
  flags: CommandFlagDefinition[];
  supported_formats: string[];
  produced_artifacts: string[];
  recommended_next_commands: string[];
  availability: CommandAvailability;
}

const GLOBAL_OUTPUT_FLAGS: CommandFlagDefinition[] = [
  {
    name: '--json',
    value_type: 'boolean',
    required: false,
    description: 'Render the canonical machine-readable JSON envelope.',
  },
  {
    name: '--format',
    value_type: 'enum',
    required: false,
    default: 'json',
    enum: ['json'],
    description: 'Explicit output format selector. Current live commands support json.',
  },
  {
    name: '--append-run-id',
    value_type: 'string',
    required: false,
    description: 'Append the command execution to an existing lifecycle run.',
  },
  {
    name: '--new-run',
    value_type: 'boolean',
    required: false,
    description: 'Force creation of a new run instead of appending to an existing run.',
  },
  {
    name: '--fail-on',
    value_type: 'enum',
    required: false,
    enum: [...FAIL_ON_STATUSES],
    description: 'Exit non-zero when the final command status is at least this severe in shared cli-core precedence.',
  },
  {
    name: '--project-root',
    value_type: 'string',
    required: false,
    description: 'Active project root for config and default artifact placement. Defaults to the current working directory or ARM_PROJECT_ROOT.',
  },
  {
    name: '--artifact-root',
    value_type: 'string',
    required: false,
    description: 'Explicit artifact root for generated runs, outputs, evidence, and logs. Defaults to <project-root>/.artifacts/sfx or ARM_ARTIFACT_ROOT.',
  },
  {
    name: '--help',
    value_type: 'boolean',
    required: false,
    description: 'Show command help.',
  },
];

export const COMMAND_REGISTRY: readonly CommandListing[] = Object.freeze([
  {
    command_id: 'commands.list',
    command: 'sfx commands',
    purpose: 'List the discovery command surface in a machine-readable envelope for low-context orchestration.',
    required_inputs: [],
    flags: GLOBAL_OUTPUT_FLAGS,
    supported_formats: ['json'],
    produced_artifacts: ['run', 'output_json', 'log'],
    recommended_next_commands: ['sfx doctor sf-cli --json'],
    availability: 'supported',
  },
  {
    command_id: 'doctor.sf-cli',
    command: 'sfx doctor sf-cli',
    purpose: 'Assess Salesforce CLI readiness for discovery workflows and recommend exact remediation or follow-up commands.',
    required_inputs: [],
    flags: GLOBAL_OUTPUT_FLAGS,
    supported_formats: ['json'],
    produced_artifacts: ['run', 'output_json', 'evidence', 'log'],
    recommended_next_commands: ['sfx discover project-inventory --repo . --json'],
    availability: 'supported',
  },
  {
    command_id: 'discover.project-inventory',
    command: 'sfx discover project-inventory',
    purpose: 'Scan a repository for Salesforce package roots, metadata families, and discovery hotspots.',
    required_inputs: [
      {
        name: 'repo',
        value_type: 'path',
        description: 'Repository root to inspect.',
      },
    ],
    flags: [
      ...GLOBAL_OUTPUT_FLAGS,
      {
        name: '--repo',
        value_type: 'string',
        required: true,
        description: 'Filesystem path to the repository to inspect.',
      },
      {
        name: '--detail',
        value_type: 'enum',
        required: false,
        default: 'standard',
        enum: ['low', 'standard', 'deep'],
        description: 'Depth of repository inspection.',
      },
    ],
    supported_formats: ['json'],
    produced_artifacts: ['run', 'output_json', 'log'],
    recommended_next_commands: ['sfx discover org-baseline --org <alias> --json'],
    availability: 'supported',
  },
  {
    command_id: 'discover.org-baseline',
    command: 'sfx discover org-baseline',
    purpose: 'Capture a read-only baseline of org capabilities, installed packages, and automation surface area.',
    required_inputs: [
      {
        name: 'org',
        value_type: 'org_alias',
        description: 'Salesforce CLI org alias or username selector.',
      },
    ],
    flags: [
      ...GLOBAL_OUTPUT_FLAGS,
      {
        name: '--org',
        value_type: 'string',
        required: true,
        description: 'Salesforce org alias or username to inspect.',
      },
      {
        name: '--detail',
        value_type: 'enum',
        required: false,
        default: 'standard',
        enum: ['low', 'standard', 'deep'],
        description: 'Depth of org inspection.',
      },
    ],
    supported_formats: ['json'],
    produced_artifacts: ['run', 'output_json', 'log'],
    recommended_next_commands: ['sfx synth discovery-brief --run-id <run_id> --json'],
    availability: 'supported',
  },
  {
    command_id: 'synth.discovery-brief',
    command: 'sfx synth discovery-brief',
    purpose: 'Synthesize saved run artifacts into a discovery brief with explicit facts, caveats, open questions, and traceable evidence.',
    required_inputs: [
      {
        name: 'run_id',
        value_type: 'run_id',
        description: 'Existing run identifier to synthesize.',
      },
    ],
    flags: [
      ...GLOBAL_OUTPUT_FLAGS,
      {
        name: '--run-id',
        value_type: 'string',
        required: true,
        description: 'Existing run identifier to synthesize.',
      },
    ],
    supported_formats: ['json'],
    produced_artifacts: ['run', 'output_json', 'evidence', 'log'],
    recommended_next_commands: ['sfx evidence show --run-id <run_id> --evidence-id <evidence_id> --json'],
    availability: 'supported',
  },
  {
    command_id: 'evidence.show',
    command: 'sfx evidence show',
    purpose: 'Inspect a bounded evidence artifact without bypassing the CLI contract through ad hoc filesystem reads.',
    required_inputs: [
      {
        name: 'run_id',
        value_type: 'run_id',
        description: 'Run that owns the evidence artifact.',
      },
      {
        name: 'evidence_id',
        value_type: 'evidence_id',
        description: 'Evidence artifact identifier to inspect.',
      },
    ],
    flags: [
      ...GLOBAL_OUTPUT_FLAGS,
      {
        name: '--run-id',
        value_type: 'string',
        required: true,
        description: 'Run that owns the evidence artifact.',
      },
      {
        name: '--evidence-id',
        value_type: 'string',
        required: true,
        description: 'Evidence artifact identifier to inspect.',
      },
    ],
    supported_formats: ['json'],
    produced_artifacts: ['run', 'output_json', 'log'],
    recommended_next_commands: [],
    availability: 'supported',
  },
]);

export function listCommands(): CommandListing[] {
  return COMMAND_REGISTRY.map((command) => ({
    ...command,
    required_inputs: command.required_inputs.map((input) => ({ ...input })),
    flags: command.flags.map((flag) => ({ ...flag, enum: flag.enum ? [...flag.enum] : undefined })),
    supported_formats: [...command.supported_formats],
    produced_artifacts: [...command.produced_artifacts],
    recommended_next_commands: [...command.recommended_next_commands],
  }));
}
