import { describe, expect, it } from 'vitest';
import { formatCents, parseCents } from './money.js';

describe('parseCents', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12.50', 1250],
    ['0,01', 1],
    [' 72,00 ', 7200],
  ])('converte %s em %i centavos', (input, expected) => {
    expect(parseCents(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,234', '-5', '1.2.3'])('rejeita %s', (input) => {
    expect(parseCents(input)).toBeNull();
  });
});

describe('formatCents', () => {
  it('formata em reais', () => {
    expect(formatCents(7200).replace(/\s/g, ' ')).toBe('R$ 72,00');
  });
});
