interface Token {
  type: 'number' | 'identifier' | 'operator' | 'paren';
  value: string;
}

export interface FormulaEvaluation {
  ok: boolean;
  value: number | null;
  identifiers: string[];
  unresolved_identifiers: string[];
  error: string | null;
}

const OPERATOR_PRECEDENCE: Record<string, number> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
};

export function extractFormulaIdentifiers(source: string): string[] {
  const identifiers = new Set<string>();
  const matches = source.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const match of matches) {
    if (!['null', 'true', 'false'].includes(match.toLowerCase())) {
      identifiers.add(match);
    }
  }
  return Array.from(identifiers).sort();
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(current)) {
      let end = index + 1;
      while (end < source.length && /[0-9.]/.test(source[end])) {
        end += 1;
      }
      const value = source.slice(index, end);
      if (!/^\d+(\.\d+)?$/.test(value)) {
        throw new Error(`Unsupported numeric literal: ${value}`);
      }
      tokens.push({ type: 'number', value });
      index = end;
      continue;
    }
    if (/[A-Za-z_]/.test(current)) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) {
        end += 1;
      }
      tokens.push({ type: 'identifier', value: source.slice(index, end) });
      index = end;
      continue;
    }
    if ('+-*/'.includes(current)) {
      tokens.push({ type: 'operator', value: current });
      index += 1;
      continue;
    }
    if ('()'.includes(current)) {
      tokens.push({ type: 'paren', value: current });
      index += 1;
      continue;
    }
    throw new Error(`Unsupported formula token: ${current}`);
  }
  return tokens;
}

function toRpn(tokens: readonly Token[]): Token[] {
  const output: Token[] = [];
  const operators: Token[] = [];
  for (const token of tokens) {
    if (token.type === 'number' || token.type === 'identifier') {
      output.push(token);
      continue;
    }
    if (token.type === 'operator') {
      while (
        operators.length > 0
        && operators[operators.length - 1]?.type === 'operator'
        && OPERATOR_PRECEDENCE[operators[operators.length - 1]?.value ?? ''] >= OPERATOR_PRECEDENCE[token.value]
      ) {
        output.push(operators.pop() as Token);
      }
      operators.push(token);
      continue;
    }
    if (token.value === '(') {
      operators.push(token);
      continue;
    }
    while (operators.length > 0 && operators[operators.length - 1]?.value !== '(') {
      output.push(operators.pop() as Token);
    }
    if (operators.length === 0) {
      throw new Error('Unbalanced formula parentheses.');
    }
    operators.pop();
  }
  while (operators.length > 0) {
    const operator = operators.pop() as Token;
    if (operator.value === '(') {
      throw new Error('Unbalanced formula parentheses.');
    }
    output.push(operator);
  }
  return output;
}

export function evaluateFormula(source: string, values: Record<string, number>): FormulaEvaluation {
  const identifiers = extractFormulaIdentifiers(source);
  const unresolved = identifiers.filter((identifier) => typeof values[identifier] !== 'number');
  if (unresolved.length > 0) {
    return { ok: false, value: null, identifiers, unresolved_identifiers: unresolved, error: 'Missing input values.' };
  }

  try {
    const stack: number[] = [];
    for (const token of toRpn(tokenize(source))) {
      if (token.type === 'number') {
        stack.push(Number(token.value));
        continue;
      }
      if (token.type === 'identifier') {
        stack.push(values[token.value] as number);
        continue;
      }
      const right = stack.pop();
      const left = stack.pop();
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw new Error('Malformed formula expression.');
      }
      if (token.value === '+') {
        stack.push(left + right);
      } else if (token.value === '-') {
        stack.push(left - right);
      } else if (token.value === '*') {
        stack.push(left * right);
      } else if (token.value === '/') {
        stack.push(left / right);
      }
    }
    if (stack.length !== 1 || !Number.isFinite(stack[0] as number)) {
      throw new Error('Formula did not resolve to one finite number.');
    }
    return { ok: true, value: stack[0] as number, identifiers, unresolved_identifiers: [], error: null };
  } catch (error) {
    return {
      ok: false,
      value: null,
      identifiers,
      unresolved_identifiers: unresolved,
      error: error instanceof Error ? error.message : 'Unsupported formula expression.',
    };
  }
}
