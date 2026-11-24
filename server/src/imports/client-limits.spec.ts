import { outsideClient, sameCell } from './imports.service';

describe('rows outside a client', () => {
  const allowed = {
    productIds: new Set(['p1']),
    investigationTypeIds: null,
  };

  it('flags a product the client does not have, on its column', () => {
    const problems = outsideClient(
      { productId: 'p2', investigationTypeId: 't9' },
      allowed,
      { product: 'المنتج' },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ field: 'product', column: 'المنتج' });
  });

  it('accepts allowed values, and anything when the list is empty (all)', () => {
    expect(outsideClient({ productId: 'p1' }, allowed, {})).toEqual([]);
    expect(
      outsideClient(
        { productId: 'p2', investigationTypeId: 't2' },
        { productIds: null, investigationTypeIds: null },
        {},
      ),
    ).toEqual([]);
    expect(outsideClient({ productId: 'p2' }, undefined, {})).toEqual([]);
  });
});

describe('matching a cell for a bulk replace', () => {
  it('ignores case and stray spaces, as the user reads the cell', () => {
    expect(sameCell('  قرض   سلع معمرة ', 'قرض سلع معمرة')).toBe(true);
    expect(sameCell('Loan', 'loan')).toBe(true);
    expect(sameCell(12, '12')).toBe(true);
  });

  it('does not match a different value or an object', () => {
    expect(sameCell('قرض شخصي', 'قرض سلع معمرة')).toBe(false);
    expect(sameCell({}, '')).toBe(false);
    expect(sameCell(undefined, 'x')).toBe(false);
  });
});
