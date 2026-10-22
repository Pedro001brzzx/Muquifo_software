import type { CreateOptionGroupInput, OptionGroup } from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
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

type KitGroup = Omit<CreateOptionGroupInput, 'options'> & {
  key: string;
  summary: string;
  options: { name: string; priceCents?: number; child?: string }[];
  /** Só aparece quando outra opção o abre; não vai para a categoria. */
  childOnly?: boolean;
  /** Ligado lanche a lanche no montador, não na categoria inteira. */
  perProduct?: boolean;
};

/** Grupos sugeridos para lanchonete; o dono ajusta preços depois. */
const kitGroups: KitGroup[] = [
  {
    key: 'ponto',
    name: 'Ponto da carne',
    minSelect: 1,
    maxSelect: 1,
    summary: 'obrigatório · ligue no montador só nos lanches de carne',
    perProduct: true,
    options: [
      { name: 'Mal passado' },
      { name: 'Ao ponto' },
      { name: 'Bem passado' },
    ],
  },
  {
    key: 'pao',
    name: 'Pão',
    minSelect: 0,
    maxSelect: 1,
    summary: 'opcional · tradicional, australiano +2, brioche +3',
    options: [
      { name: 'Tradicional' },
      { name: 'Australiano', priceCents: 200 },
      { name: 'Brioche', priceCents: 300 },
    ],
  },
  {
    key: 'blend',
    name: 'Blend',
    minSelect: 0,
    maxSelect: 1,
    summary: 'opcional · duplo +8, triplo +14',
    options: [
      { name: 'Duplo', priceCents: 800 },
      { name: 'Triplo', priceCents: 1400 },
    ],
  },
  {
    key: 'adicionais',
    name: 'Adicionais',
    minSelect: 0,
    maxSelect: 5,
    summary: 'até 5 · bacon, cheddar, ovo, cebola caramelizada',
    options: [
      { name: 'Bacon', priceCents: 400 },
      { name: 'Cheddar', priceCents: 350 },
      { name: 'Ovo', priceCents: 200 },
      { name: 'Cebola caramelizada', priceCents: 300 },
    ],
  },
  {
    key: 'molho',
    name: 'Molho extra',
    minSelect: 0,
    maxSelect: 2,
    summary: 'até 2 · barbecue, maionese verde, mostarda e mel',
    options: [
      { name: 'Barbecue' },
      { name: 'Maionese verde' },
      { name: 'Mostarda e mel' },
    ],
  },
  {
    key: 'bebida',
    name: 'Bebida do combo',
    minSelect: 1,
    maxSelect: 1,
    summary: 'aberto pelo combo · refrigerante, suco +2, água',
    childOnly: true,
    options: [
      { name: 'Refrigerante lata' },
      { name: 'Suco natural', priceCents: 200 },
      { name: 'Água' },
    ],
  },
  {
    key: 'combo',
    name: 'Vira combo',
    minSelect: 0,
    maxSelect: 1,
    summary: 'opcional · combo +15 (escolhe a bebida), só batata +9',
    options: [
      { name: 'Combo (batata + bebida)', priceCents: 1500, child: 'bebida' },
      { name: 'Só batata', priceCents: 900 },
    ],
  },
];

const kitIngredients = [
  'Pão brioche',
  'Pão australiano',
  'Blend 150g',
  'Filé de frango',
  'Queijo prato',
  'Cheddar',
  'Bacon',
  'Alface',
  'Tomate',
  'Cebola roxa',
  'Picles',
  'Maionese da casa',
  'Ketchup',
  'Mostarda',
];

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Cria os grupos e ingredientes do modelo, reaproveitando o que já existe. */
export function StarterKitDialog({
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
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(kitGroups.map((g) => g.key)),
  );
  const [withIngredients, setWithIngredients] = useState(true);
  const [categoryId, setCategoryId] = useState('none');

  useEffect(() => {
    if (!open) return;
    const lanches = categories.data?.find((c) =>
      /lanche|hamb|sandu/i.test(c.name),
    );
    setCategoryId(lanches?.id ?? 'none');
  }, [open, categories.data]);

  const toggle = (key: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // O combo depende da bebida.
      if (key === 'combo' && next.has('combo')) next.add('bebida');
      if (key === 'bebida' && !next.has('bebida')) next.delete('combo');
      return next;
    });

  const apply = useMutation({
    mutationFn: async () => {
      const existing = await api.optionGroups({ status: 'all' });
      const byKey = new Map<string, OptionGroup>();
      let created = 0;
      // Bebida antes do combo, que aponta para ela.
      const ordered = [...kitGroups].sort(
        (a, b) => Number(!!b.childOnly) - Number(!!a.childOnly),
      );
      for (const g of ordered) {
        if (!picked.has(g.key)) continue;
        const found = existing.find((e) => same(e.name, g.name));
        if (found) {
          byKey.set(g.key, found);
          continue;
        }
        const group = await api.createOptionGroup({
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          options: g.options.map((o) => ({
            name: o.name,
            priceCents: o.priceCents ?? 0,
            childGroupId: o.child ? (byKey.get(o.child)?.id ?? null) : null,
          })),
        });
        byKey.set(g.key, group);
        created++;
      }

      let linked = 0;
      if (categoryId !== 'none') {
        const category = categories.data?.find((c) => c.id === categoryId);
        const topLevel = kitGroups
          .filter((g) => !g.childOnly && !g.perProduct && byKey.has(g.key))
          .map((g) => byKey.get(g.key)!.id);
        const ids = [
          ...new Set([...(category?.optionGroupIds ?? []), ...topLevel]),
        ];
        linked = ids.length - (category?.optionGroupIds.length ?? 0);
        await api.updateCategory(categoryId, { optionGroupIds: ids });
      }

      let ingredientsCreated = 0;
      if (withIngredients) {
        const library = await api.ingredients({ status: 'all' });
        for (const name of kitIngredients) {
          if (library.some((i) => same(i.name, name))) continue;
          await api.createIngredient({ name });
          ingredientsCreated++;
        }
      }
      return { created, linked, ingredientsCreated };
    },
    onSuccess: ({ created, linked, ingredientsCreated }) => {
      toast.success('Modelo de lanchonete aplicado', {
        description: [
          `${created} grupo(s) criado(s)`,
          categoryId !== 'none' && `${linked} ligado(s) à categoria`,
          withIngredients &&
            `${ingredientsCreated} ingrediente(s) na biblioteca`,
        ]
          .filter(Boolean)
          .join(' · '),
      });
      void qc.invalidateQueries({ queryKey: queryKeys.optionGroups });
      void qc.invalidateQueries({ queryKey: queryKeys.categories });
      void qc.invalidateQueries({ queryKey: queryKeys.ingredients });
      onClose();
    },
    onError: (e) => {
      toastError(e);
      // O que já foi criado fica; reaplicar reaproveita pelo nome.
      void qc.invalidateQueries({ queryKey: queryKeys.optionGroups });
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
            <Sparkles className="size-5 text-primary" /> Modelo de lanchonete
          </DialogTitle>
          <DialogDescription>
            Cria os grupos mais comuns já preenchidos. Grupos com o mesmo nome
            que já existem são reaproveitados. Depois é só ajustar os preços.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex-1 space-y-4 overflow-y-auto px-6">
          <ul className="divide-y rounded-lg border">
            {kitGroups.map((g) => (
              <li key={g.key}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                    checked={picked.has(g.key)}
                    onChange={() => toggle(g.key)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{g.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {g.summary}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={withIngredients}
              onChange={(e) => setWithIngredients(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">
                Ingredientes comuns na biblioteca
              </span>
              <span className="block text-xs text-muted-foreground">
                {kitIngredients.join(', ')}
              </span>
            </span>
          </label>

          <Field
            label="Ligar os grupos à categoria"
            hint="Todo lanche da categoria passa a oferecer esses grupos; no montador dá para desligar em um lanche específico (ex.: ponto no X-Frango)."
          >
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não ligar agora</SelectItem>
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
            disabled={
              apply.isPending || (picked.size === 0 && !withIngredients)
            }
            onClick={() => apply.mutate()}
          >
            {apply.isPending && <Loader2 className="animate-spin" />}
            Aplicar modelo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
