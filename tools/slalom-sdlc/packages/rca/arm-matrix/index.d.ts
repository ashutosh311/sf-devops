export interface ArmMatrixSimulationRequirement {
  tier: unknown;
  strategy: unknown;
  reference: unknown;
}

export interface ArmMatrixSimulationPoint {
  discount: number;
  requirements: ArmMatrixSimulationRequirement[];
}

export interface ArmMatrixResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  simulations: Record<string, ArmMatrixSimulationPoint[]>;
}

/**
 * Validate an ARM approval-matrix scenario document and compute boundary
 * routing simulations. Pure — never reads files, logs, or exits.
 * Throws TypeError when the document shape is structurally invalid.
 */
export function validateArmMatrix(document: unknown): ArmMatrixResult;
