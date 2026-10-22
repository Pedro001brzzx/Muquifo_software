import { formatCents } from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pizza } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, queryKeys } from '@/api';
import { Field } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toastError } from '@/lib/errors';

const NEW = '__new';
const NONE = 'none';

/** P=1, M=2, G=3 sabores. */
export const kitSizes = [
  { key: 'p', name: 'Pizza Pequena', maxFlavors: 1 },
  { key: 'm', name: 'Pizza Média', maxFlavors: 2 },
  { key: 'g', name: 'Pizza Grande', maxFlavors: 3 },
] as const;

type SizeKey = (typeof kitSizes)[number]['key'];

/** Preços sugeridos por faixa e tamanho; o dono ajusta na tabela depois. */
const kitTiers: {
  name: string;
  prices: Record<SizeKey, number>;
  flavors: [string, string][];
}[] = [
  {
    name: 'Tradicional',
    prices: { p: 3500, m: 4800, g: 5900 },
    flavors: [
      ['Mussarela', 'molho, mussarela, orégano'],
      ['Calabresa', 'molho, mussarela, calabresa, cebola'],
      ['Marguerita', 'molho, mussarela, tomate, manjericão'],
      ['Portuguesa', 'molho, mussarela, presunto, ovo, cebola, azeitona'],
      ['Frango com catupiry', 'molho, frango desfiado, catupiry'],
      ['Milho', 'molho, mussarela, milho'],
      ['Napolitana', 'molho, mussarela, tomate, parmesão'],
    ],
  },
  {
    name: 'Especial',
    prices: { p: 4200, m: 5800, g: 6900 },
    flavors: [
      ['Quatro queijos', 'mussarela, catupiry, provolone, parmesão'],
      ['Pepperoni', 'molho, mussarela, pepperoni'],
      ['Carne seca', 'mussarela, carne seca, cebola, catupiry'],
      ['Lombo canadense', 'mussarela, lombo, catupiry'],
      ['Bacon com cheddar', 'mussarela, bacon, cheddar'],
    ],
  },
  {
    name: 'Doce',
    prices: { p: 3500, m: 4600, g: 5600 },
    flavors: [
      ['Chocolate', 'chocolate ao leite, granulado'],
      ['Romeu e Julieta', 'mussarela, goiabada'],
      ['Banana com canela', 'banana, açúcar, canela, leite condensado'],
      ['Prestígio', 'chocolate, coco ralado'],
    ],
  },
];

const kitBorda = {
  name: 'Borda recheada',
  options: [
    { name: 'Catupiry', priceCents: 1000 },
    { name: 'Cheddar', priceCents: 1000 },
    { name: 'Chocolate', priceCents: 1200 },
  ],
};

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export const looksPizza = (name: string) => /pizza/i.test(name);

/**
 * Monta a pizzaria pronta: categoria, tamanhos P/M/G, faixas com preço por
 * tamanho, sabores mais pedidos e borda. Reaproveita o que já existe pelo nome.
 */
export function PizzaKitDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: queryKeys.categories,
    queryFn: api.categories,
    enabled: open,
  });
  const sectors = useQuery({
    queryKey: queryKeys.sectors,
    queryFn: api.sectors,
    enabled: open,
  });
  const [categoryId, setCategoryId] = useState(NEW);
  const [sectorId, setSectorId] = useState(NONE);
  const [withFlavors, setWithFlavors] = useState(true);
  const [withBorda, setWithBorda] = useState(true);

  useEffect(() => {
    if (!open) return;
    const pizzas = categories.data?.find((c) => c.active && looksPizza(c.name));
    setCategoryId(pizzas?.id ?? NEW);
    const sector =
      sectors.data?.find((s) => /pizza|forno/i.test(s.name)) ??
      sectors.data?.find((s) => /cozinha/i.test(s.name));
    setSectorId(sector?.id ?? NONE);
  }, [open, categories.data, sectors.data]);

  const apply = useMutation({
    mutationFn: async () => {
      const category =
        categoryId === NEW
          ? (categories.data?.find((c) => same(c.name, 'Pizzas')) ??
            (await api.createCategory({ name: 'Pizzas' })))
          : categories.data!.find((c) => c.id === categoryId)!;

      // Tamanhos: reaproveita o produto de mesmo nome na categoria. Pizza de
      // preço fixo vira tamanho (o preço passa a vir da faixa do sabor).
      const products = await api.products({ status: 'all' });
      const sizeIds = {} as Record<SizeKey, string>;
      let sizesCreated = 0;
      for (const s of kitSizes) {
        const found = products.find(
          (p) =>
            p.active && p.categoryId === category.id && same(p.name, s.name),
        );
        if (found) {
          sizeIds[s.key] = found.id;
          if (found.maxFlavors === null) {
            await api.updateProduct(found.id, {
              version: found.version,
              maxFlavors: s.maxFlavors,
              priceCents: 0,
            });
            sizesCreated++;
          }
          continue;
        }
        const created = await api.createProduct({
          categoryId: category.id,
          sectorId: sectorId === NONE ? null : sectorId,
          name: s.name,
          priceCents: 0,
          maxFlavors: s.maxFlavors,
        });
        sizeIds[s.key] = created.id;
        sizesCreated++;
      }

      // Faixas: completa só os tamanhos que ainda não têm preço.
      const tiers = await api.pizzaTiers({ status: 'all' });
      const flavors = await api.pizzaFlavors({ status: 'all' });
      let flavorsCreated = 0;
      for (const [i, t] of kitTiers.entries()) {
        const kitPrices = kitSizes.map((s) => ({
          productId: sizeIds[s.key],
          priceCents: t.prices[s.key],
        }));
        let tier = tiers.find((x) => same(x.name, t.name));
        if (!tier) {
          tier = await api.createPizzaTier({
            name: t.name,
            sortOrder: i,
            prices: kitPrices,
          });
        } else {
          const missing = kitPrices.filter(
            (p) => !tier!.prices.some((x) => x.productId === p.productId),
          );
          if (missing.length || !tier.active) {
            tier = await api.updatePizzaTier(tier.id, {
              active: true,
              prices: [...tier.prices, ...missing],
            });
          }
        }
        if (!withFlavors) continue;
        for (const [j, [name, description]] of t.flavors.entries()) {
          if (flavors.some((f) => same(f.name, name))) continue;
          await api.createPizzaFlavor({
            tierId: tier.id,
            name,
            description,
            sortOrder: j,
          });
          flavorsCreated++;
        }
      }

      let bordaLinked = false;
      if (withBorda) {
        const groups = await api.optionGroups({ status: 'all' });
        const borda =
          groups.find((g) => same(g.name, kitBorda.name)) ??
          (await api.createOptionGroup({
            name: kitBorda.name,
            minSelect: 0,
            maxSelect: 1,
            options: kitBorda.options,
          }));
        if (!category.optionGroupIds.includes(borda.id)) {
          await api.updateCategory(category.id, {
            optionGroupIds: [...category.optionGroupIds, borda.id],
          });
          bordaLinked = true;
        }
      }
      return { sizesCreated, flavorsCreated, bordaLinked };
    },
    onSuccess: ({ sizesCreated, flavorsCreated, bordaLinked }) => {
      toast.success('Pizzaria montada', {
        description: [
          `${sizesCreated} tamanho(s) criado(s) ou convertido(s)`,
          withFlavors && `${flavorsCreated} sabor(es)`,
          bordaLinked && 'borda ligada às pizzas',
        ]
          .filter(Boolean)
          .join(' · '),
      });
      onClose();
    },
    onError: toastError,
    // O que já foi criado fica; reaplicar reaproveita pelo nome.
    onSettled: () => {
      for (const key of [
        queryKeys.categories,
        queryKeys.products,
        queryKeys.pizzaTiers,
        queryKeys.pizzaFlavors,
        queryKeys.optionGroups,
      ])
        void qc.invalidateQueries({ queryKey: key });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !apply.isPending && onClose()}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pizza className="size-5 text-primary" /> Modelo de pizzaria
          </DialogTitle>
          <DialogDescription>
            Cria os tamanhos, as faixas de preço e os sabores mais pedidos. O
            que já existir com o mesmo nome é reaproveitado; uma pizza de preço
            fixo com o nome de um tamanho passa a cobrar pelo sabor. Depois é só
            ajustar os preços na tabela.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex-1 space-y-4 overflow-y-auto px-6">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Faixa</th>
                  {kitSizes.map((s) => (
                    <th
                      key={s.key}
                      className="px-3 py-2 text-right font-medium"
                    >
                      {s.key.toUpperCase()} · {s.maxFlavors}{' '}
                      {s.maxFlavors === 1 ? 'sabor' : 'sabores'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {kitTiers.map((t) => (
                  <tr key={t.name}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{t.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t.flavors.length} sabores
                      </span>
                    </td>
                    {kitSizes.map((s) => (
                      <td key={s.key} className="px-3 py-2 text-right tabular">
                        {formatCents(t.prices[s.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={withFlavors}
              onChange={(e) => setWithFlavors(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">
                Sabores mais pedidos
              </span>
              <span className="block text-xs text-muted-foreground">
                {kitTiers.flatMap((t) => t.flavors.map((f) => f[0])).join(', ')}
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={withBorda}
              onChange={(e) => setWithBorda(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">Borda recheada</span>
              <span className="block text-xs text-muted-foreground">
                opcional · catupiry +10, cheddar +10, chocolate +12
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Categoria">
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW}>Criar “Pizzas”</SelectItem>
                  {categories.data
                    ?.filter((c) => c.active)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Preparado em">
              <Select value={sectorId} onValueChange={setSectorId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum setor</SelectItem>
                  {sectors.data?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={apply.isPending}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            disabled={apply.isPending || categories.isLoading}
            onClick={() => apply.mutate()}
          >
            {apply.isPending && <Loader2 className="animate-spin" />}
            Montar pizzaria
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
