/**
 * Figuras do cardápio: emojis do próprio sistema (funcionam sem internet).
 * A figura sai do nome ("Coca lata" → 🥫) e o dono pode trocar.
 */

export type ItemKind =
  | 'burger'
  | 'pizza'
  | 'drink'
  | 'side'
  | 'dessert'
  | 'dish'
  | 'other';

export interface Figure {
  emoji: string;
  label: string;
  /** Pedaços de nome, sem acento e em minúsculas. */
  words: string[];
}

export const figureGroups: { title: string; figures: Figure[] }[] = [
  {
    title: 'Lanches',
    figures: [
      {
        emoji: '🍔',
        label: 'Hambúrguer',
        words: ['x-', 'burger', 'burguer', 'hamb', 'smash', 'lanche'],
      },
      {
        emoji: '🌭',
        label: 'Cachorro-quente',
        words: ['dog', 'cachorro', 'salsicha'],
      },
      {
        emoji: '🥪',
        label: 'Sanduíche',
        words: ['sanduiche', 'misto', 'bauru', 'beirute', 'lanche natural'],
      },
      {
        emoji: '🌯',
        label: 'Wrap',
        words: ['wrap', 'burrito', 'kebab', 'shawarma'],
      },
      { emoji: '🌮', label: 'Taco', words: ['taco', 'nacho'] },
      {
        emoji: '🥟',
        label: 'Pastel',
        words: [
          'pastel',
          'empada',
          'esfiha',
          'esfirra',
          'coxinha',
          'salgado',
          'kibe',
          'quibe',
        ],
      },
    ],
  },
  {
    title: 'Pizza e pratos',
    figures: [
      {
        emoji: '🍕',
        label: 'Pizza',
        words: ['pizza', 'calabresa', 'mussarela', 'marguerita'],
      },
      {
        emoji: '🍛',
        label: 'Prato feito',
        words: [
          'prato',
          'pf',
          'executivo',
          'marmita',
          'feijoada',
          'strogonoff',
          'estrogonofe',
        ],
      },
      {
        emoji: '🍝',
        label: 'Massa',
        words: [
          'macarr',
          'massa',
          'espaguete',
          'lasanha',
          'nhoque',
          'talharim',
        ],
      },
      {
        emoji: '🥩',
        label: 'Carne',
        words: ['picanha', 'carne', 'alcatra', 'file', 'costela', 'bife'],
      },
      {
        emoji: '🍗',
        label: 'Frango',
        words: ['frango', 'galinha', 'asinha', 'coxa', 'peito'],
      },
      {
        emoji: '🐟',
        label: 'Peixe',
        words: ['peixe', 'tilapia', 'salmao', 'bacalhau', 'camarao'],
      },
      { emoji: '🥗', label: 'Salada', words: ['salada', 'verde'] },
      { emoji: '🍲', label: 'Caldo', words: ['caldo', 'sopa', 'canja'] },
      { emoji: '🍚', label: 'Arroz', words: ['arroz', 'risoto'] },
    ],
  },
  {
    title: 'Porções',
    figures: [
      {
        emoji: '🍟',
        label: 'Batata frita',
        words: ['batata', 'fritas', 'mandioca', 'aipim', 'polenta'],
      },
      { emoji: '🧅', label: 'Cebola', words: ['onion', 'cebola'] },
      {
        emoji: '🍤',
        label: 'Empanado',
        words: ['isca', 'empanad', 'nugget', 'tempura'],
      },
      {
        emoji: '🧀',
        label: 'Queijo',
        words: ['queijo', 'provolone', 'coalho'],
      },
      { emoji: '🥓', label: 'Bacon', words: ['bacon', 'torresmo', 'linguica'] },
      {
        emoji: '🥜',
        label: 'Petisco',
        words: ['amendoim', 'petisco', 'tira-gosto', 'tira gosto'],
      },
    ],
  },
  {
    title: 'Bebidas',
    figures: [
      {
        emoji: '🥤',
        label: 'Refrigerante',
        words: ['refri', 'coca', 'guarana', 'fanta', 'sprite', 'pepsi', 'soda'],
      },
      { emoji: '🥫', label: 'Lata', words: ['lata'] },
      { emoji: '💧', label: 'Água', words: ['agua'] },
      {
        emoji: '🧃',
        label: 'Suco',
        words: ['suco', 'laranja', 'limonada', 'maracuja'],
      },
      {
        emoji: '🍺',
        label: 'Cerveja',
        words: [
          'cerveja',
          'chopp',
          'chope',
          'long neck',
          'heineken',
          'brahma',
          'skol',
        ],
      },
      {
        emoji: '🍹',
        label: 'Drink',
        words: ['caipi', 'drink', 'batida', 'mojito', 'gin tonica'],
      },
      { emoji: '🍷', label: 'Vinho', words: ['vinho', 'taca'] },
      {
        emoji: '🥃',
        label: 'Dose',
        words: ['dose', 'cachaca', 'whisky', 'vodka', 'pinga'],
      },
      {
        emoji: '☕',
        label: 'Café',
        words: ['cafe', 'expresso', 'capuccino', 'cappuccino'],
      },
      {
        emoji: '🥛',
        label: 'Milk-shake',
        words: ['shake', 'leite', 'vitamina'],
      },
    ],
  },
  {
    title: 'Doces',
    figures: [
      { emoji: '🍰', label: 'Bolo', words: ['bolo', 'torta', 'cheesecake'] },
      {
        emoji: '🍫',
        label: 'Chocolate',
        words: ['chocolate', 'brownie', 'brigadeiro', 'gateau', 'petit'],
      },
      { emoji: '🍨', label: 'Sorvete', words: ['sorvete', 'sundae', 'gelato'] },
      { emoji: '🍧', label: 'Açaí', words: ['acai', 'cupuacu'] },
      { emoji: '🍮', label: 'Pudim', words: ['pudim', 'flan', 'mousse'] },
      {
        emoji: '🥞',
        label: 'Panqueca',
        words: ['panqueca', 'crepe', 'waffle'],
      },
    ],
  },
  {
    title: 'Outros',
    figures: [{ emoji: '🍽️', label: 'Prato', words: [] }],
  },
];

const allFigures = figureGroups.flatMap((g) => g.figures);

/** Figura padrão de cada tipo, quando o nome não diz nada. */
export const kindFigure: Record<ItemKind, string> = {
  burger: '🍔',
  pizza: '🍕',
  drink: '🥤',
  side: '🍟',
  dessert: '🍰',
  dish: '🍛',
  other: '🍽️',
};

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Figura pelo nome; a palavra mais longa encontrada ganha ("suco de laranja" > "lata"). */
export function guessFigure(name: string): string | null {
  const text = normalize(name);
  // "X-Frango", "X Salada": é hambúrguer, mesmo citando o recheio.
  if (/^x[-\s]/.test(text)) return '🍔';
  let best: { emoji: string; size: number } | null = null;
  for (const f of allFigures) {
    for (const w of f.words) {
      if (text.includes(w) && (!best || w.length > best.size))
        best = { emoji: f.emoji, size: w.length };
    }
  }
  return best?.emoji ?? null;
}

/** Tipo pelo nome da categoria, para a figura de reserva. */
export function kindOfCategory(name = ''): ItemKind {
  const n = normalize(name);
  if (/pizza/.test(n)) return 'pizza';
  if (/lanche|hamb|burg|sandu/.test(n)) return 'burger';
  if (/bebida|drink|suco|cerveja/.test(n)) return 'drink';
  if (/porc|acompanh|petisc|entrada/.test(n)) return 'side';
  if (/sobremesa|doce/.test(n)) return 'dessert';
  if (/prato|refei|almoco|executivo/.test(n)) return 'dish';
  return 'other';
}

/** O que mostrar: a escolhida, a do nome ou a do tipo da categoria. */
export const figureOf = (
  product: { icon: string | null; name: string },
  categoryName?: string,
) =>
  product.icon ??
  guessFigure(product.name) ??
  kindFigure[kindOfCategory(categoryName)];
