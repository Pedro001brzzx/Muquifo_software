import { describe, expect, it } from 'vitest';
import { figureOf, guessFigure } from './figures';

describe('guessFigure', () => {
  it.each([
    ['X-Frango Bacon', '🍔'],
    ['X Salada', '🍔'],
    ['Suco natural', '🧃'],
    ['Coca-Cola lata', '🥤'],
    ['Água com gás', '💧'],
    ['Batata frita com cheddar', '🍟'],
    ['Pastel de carne', '🥟'],
    ['Salada da casa', '🥗'],
    ['Chopp 300ml', '🍺'],
    ['Petit gâteau', '🍫'],
  ])('%s → %s', (name, emoji) => {
    expect(guessFigure(name)).toBe(emoji);
  });

  it('sem palpite pelo nome usa a escolhida ou a da categoria', () => {
    expect(guessFigure('Especial da casa')).toBeNull();
    expect(figureOf({ icon: null, name: 'Especial da casa' }, 'Bebidas')).toBe(
      '🥤',
    );
    expect(figureOf({ icon: '🍷', name: 'Coca' })).toBe('🍷');
  });
});
