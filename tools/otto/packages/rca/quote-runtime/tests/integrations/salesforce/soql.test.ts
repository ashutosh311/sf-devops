import { describe, expect, it } from 'vitest';

import {
  buildSoqlSelect,
  escapeSoqlStringLiteral,
  joinSoqlFields,
  quoteSoqlId,
  quoteSoqlIds
} from '../../../src/integrations/salesforce/soql';

describe('soql helpers', () => {
  it('escapeSoqlStringLiteral escapes backslashes, single quotes, and combined sequences', () => {
    expect(escapeSoqlStringLiteral('hello')).toBe('hello');
    expect(escapeSoqlStringLiteral("O'Brien")).toBe("O\\'Brien");
    expect(escapeSoqlStringLiteral('back\\slash')).toBe('back\\\\slash');
    expect(escapeSoqlStringLiteral("a\\'b")).toBe("a\\\\\\'b");
  });

  it('quotes ids for safe SOQL string literals', () => {
    expect(quoteSoqlId('0Q0a5000002CcQ9CAK')).toBe("'0Q0a5000002CcQ9CAK'");
    expect(quoteSoqlId("a'b\\c")).toBe("'a\\'b\\\\c'");
  });

  it('joins field lists deterministically', () => {
    expect(joinSoqlFields(['Id', 'Name', 'QuoteNumber'])).toBe('Id, Name, QuoteNumber');
    expect(quoteSoqlIds(['0Q0a5000002CcQ9CAK', '0Q0a5000002Yr2LCAS'])).toBe(
      "'0Q0a5000002CcQ9CAK', '0Q0a5000002Yr2LCAS'"
    );
  });

  it('constructs deterministic select statements', () => {
    expect(
      buildSoqlSelect({
        objectName: 'Quote',
        fields: ['Id', 'Name', 'Status'],
        where: "Id = '0Q0a5000002CcQ9CAK'"
      })
    ).toBe("SELECT Id, Name, Status FROM Quote WHERE Id = '0Q0a5000002CcQ9CAK'");

    expect(
      buildSoqlSelect({
        objectName: 'QuoteLineItem',
        fields: ['Id', 'QuoteId', 'LineNumber'],
        where: "QuoteId IN ('0Q0a5000002CcQ9CAK', '0Q0a5000002Yr2LCAS')",
        orderBy: ['QuoteId', 'LineNumber'],
        limit: 50
      })
    ).toBe(
      "SELECT Id, QuoteId, LineNumber FROM QuoteLineItem WHERE QuoteId IN ('0Q0a5000002CcQ9CAK', '0Q0a5000002Yr2LCAS') ORDER BY QuoteId, LineNumber LIMIT 50"
    );
  });
});
