export type SoqlSelectOptions = {
  readonly objectName: string;
  readonly fields: readonly string[];
  readonly where?: string;
  readonly orderBy?: string | readonly string[];
  readonly limit?: number;
};

export function quoteSoqlId(id: string): string {
  return `'${escapeSoqlStringLiteral(id)}'`;
}

export function quoteSoqlIds(ids: readonly string[]): string {
  return ids.map((id) => quoteSoqlId(id)).join(', ');
}

export function joinSoqlFields(fields: readonly string[]): string {
  return fields.join(', ');
}

export function buildSoqlSelect(options: SoqlSelectOptions): string {
  if (options.fields.length === 0) {
    throw new Error('SOQL select statements require at least one field.');
  }

  const clauses = [
    `SELECT ${joinSoqlFields(options.fields)}`,
    `FROM ${options.objectName}`
  ];

  if (options.where) {
    clauses.push(`WHERE ${options.where}`);
  }

  const orderByClause = normalizeOrderBy(options.orderBy);
  if (orderByClause) {
    clauses.push(`ORDER BY ${orderByClause}`);
  }

  if (options.limit !== undefined) {
    clauses.push(`LIMIT ${options.limit}`);
  }

  return clauses.join(' ');
}

function normalizeOrderBy(orderBy?: string | readonly string[]): string | null {
  if (orderBy === undefined) {
    return null;
  }

  if (typeof orderBy === 'string') {
    return orderBy;
  }

  if (orderBy.length === 0) {
    return null;
  }

  return orderBy.join(', ');
}

export function escapeSoqlStringLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
