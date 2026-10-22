import { parseCents } from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChefHat,
  ClipboardPaste,
  CupSoda,
  Loader2,
  type LucideIcon,
  Package,
  Pizza,
  Plus,
  Soup,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api, queryKeys } from '@/api';
import { Field } from '@/components/form-dialog';
import { centsToInput, MoneyInput } from '@/components/money-input';
import { parsePastedOptions } from '@/components/option-groups';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type QuickKind = 'drink' | 'side';

const NEW = '__new';
const NONE = 'none';

const presets: Record<
  QuickKind,
  {
    title: string;
    description: string;
    categoryName: string;
    categoryMatch: RegExp;
    sectorMatch: RegExp;
    placeholder: string;
    suggestions: string[];
  }
> = {
  drink: {
    title: 'Cadastrar bebidas',
    description:
      'Várias de uma vez: nome e preço, Enter passa para a próxima. Toque nas sugestões para ganhar tempo.',
    categoryName: 'Bebidas',
    categoryMatch: /bebida|drink/i,
    sectorMatch: /bar|copa|bebida/i,
    placeholder: 'Ex.: Coca-Cola lata 350ml',
    suggestions: [
      'Refrigerante lata',
      'Refrigerante 2L',
      'Água sem gás',
      'Água com gás',
      'Suco natural',
      'Cerveja long neck',
      'Cerveja 600ml',
      'Chopp 300ml',
      'Caipirinha',
    ],
  },
  side: {
    title: 'Cadastrar porções e acompanhamentos',
    description:
      'Várias de uma vez: nome e preço, Enter passa para a próxima. Tamanhos (meia/inteira) podem virar um complemento depois.',
    categoryName: 'Porções',
    categoryMatch: /porç|acompanh|petisc|entrada/i,
    sectorMatch: /cozinha/i,
    placeholder: 'Ex.: Batata frita 400g',
    suggestions: [
      'Batata frita',
      'Batata com cheddar e bacon',
      'Onion rings',
      'Mandioca frita',
      'Polenta frita',
      'Isca de frango',
      'Calabresa acebolada',
      'Arroz',
      'Salada da casa',
    ],
  },
};

interface Row {
  key: number;
  name: string;
  priceText: string;
  error?: string;
}

let nextKey = 1;
const emptyRow = (name = '', priceText = ''): Row => ({
  key: nextKey++,
  name,
  priceText,
});
const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const fieldId = (key: number, field: 'name' | 'price') =>
  `quick-${field}-${key}`;
const focusField = (key: number, field: 'name' | 'price') =>
  document.getElementById(fieldId(key, field))?.focus();

/** Lista rápida de produtos simples (nome + preço) numa categoria só. */
export function QuickAddDialog({
  kind,
  onClose,
}: {
  kind: QuickKind | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const open = kind !== null;
  const preset = presets[kind ?? 'drink'];
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
  const products = useQuery({
    queryKey: [...queryKeys.products, 'admin'],
    queryFn: () => api.products({ status: 'all' }),
    enabled: open,
  });
  const [categoryId, setCategoryId] = useState(NEW);
  const [sectorId, setSectorId] = useState(NONE);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const focusKey = useRef<{ key: number; field: 'name' | 'price' } | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    setRows([emptyRow()]);
    setPasting(false);
    setPasteText('');
  }, [open]);

  useEffect(() => {
    if (!open || !categories.data || !sectors.data) return;
    const match = categories.data.find(
      (c) => c.active && preset.categoryMatch.test(c.name),
    );
    setCategoryId(match?.id ?? NEW);
    setSectorId(
      sectors.data.find((s) => preset.sectorMatch.test(s.name))?.id ?? NONE,
    );
  }, [open, categories.data, sectors.data, preset]);

  // Foco depois que a linha nova aparece na tela.
  useEffect(() => {
    const target = focusKey.current;
    if (!target) return;
    focusKey.current = null;
    focusField(target.key, target.field);
  });

  const inCategory = (products.data ?? []).filter(
    (p) => p.active && p.categoryId === categoryId,
  );
  const taken = (name: string) =>
    inCategory.some((p) => same(p.name, name)) ||
    rows.some((r) => same(r.name, name));
  const filled = rows.filter((r) => r.name.trim());

  const setRow = (key: number, patch: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, ...patch, error: undefined } : r)),
    );

  function addRow(name = '', focus: 'name' | 'price' = 'name') {
    const row = emptyRow(name);
    focusKey.current = { key: row.key, field: focus };
    setRows((rs) => {
      // Reaproveita a última linha se estiver vazia.
      const last = rs.at(-1);
      if (last && !last.name.trim() && !last.priceText) {
        focusKey.current = { key: last.key, field: focus };
        return rs.map((r) => (r === last ? { ...r, name } : r));
      }
      return [...rs, row];
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      const category =
        categoryId === NEW
          ? (categories.data?.find((c) => same(c.name, preset.categoryName)) ??
            (await api.createCategory({ name: preset.categoryName })))
          : { id: categoryId };
      const failed: Row[] = [];
      let created = 0;
      for (const r of filled) {
        try {
          await api.createProduct({
            categoryId: category.id,
            sectorId: sectorId === NONE ? null : sectorId,
            name: r.name.trim(),
            priceCents: parseCents(r.priceText) ?? 0,
          });
          created++;
        } catch (e) {
          failed.push({
            ...r,
            error: e instanceof Error ? e.message : 'Falha ao salvar.',
          });
        }
      }
      return { created, failed, categoryId: category.id };
    },
    onSuccess: ({ created, failed, categoryId: id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.products });
      void qc.invalidateQueries({ queryKey: queryKeys.categories });
      if (created)
        toast.success(`${created} item(ns) no cardápio`, {
          description: 'Já aparecem para o garçom.',
        });
      if (failed.length) {
        setCategoryId(id);
        setRows(failed);
        return;
      }
      onClose();
    },
  });

  function submit() {
    const checked = rows.map((r) => {
      const cents = parseCents(r.priceText);
      return r.name.trim() && (cents === null || cents <= 0)
        ? { ...r, error: 'Informe o preço.' }
        : r;
    });
    setRows(checked);
    if (checked.every((r) => !r.error) && filled.length) save.mutate();
  }

  const suggestions = preset.suggestions.filter((s) => !taken(s));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !save.isPending && onClose()}
    >
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{preset.title}</DialogTitle>
          <DialogDescription>{preset.description}</DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex-1 space-y-4 overflow-y-auto px-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoria">
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!categories.data?.some((c) =>
                    same(c.name, preset.categoryName),
                  ) && (
                    <SelectItem value={NEW}>
                      Criar “{preset.categoryName}”
                    </SelectItem>
                  )}
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

          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="xs"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => addRow(s, 'price')}
                >
                  <Plus /> {s}
                </Button>
              ))}
            </div>
          )}

          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.key} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    id={fieldId(r.key, 'name')}
                    autoFocus={i === 0}
                    placeholder={i === 0 ? preset.placeholder : 'Nome'}
                    maxLength={120}
                    className="flex-1"
                    value={r.name}
                    onChange={(e) => setRow(r.key, { name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      focusField(r.key, 'price');
                    }}
                  />
                  <div
                    className="w-32 shrink-0"
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      if (i === rows.length - 1) addRow();
                      else focusField(rows[i + 1].key, 'name');
                    }}
                  >
                    <MoneyInput
                      id={fieldId(r.key, 'price')}
                      className="h-9 text-sm font-medium md:text-sm"
                      value={r.priceText}
                      invalid={!!r.error}
                      onChange={(v) => setRow(r.key, { priceText: v })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remover linha"
                    disabled={rows.length === 1}
                    onClick={() =>
                      setRows((rs) => rs.filter((x) => x.key !== r.key))
                    }
                  >
                    <X />
                  </Button>
                </div>
                {(r.error ||
                  (r.name.trim() &&
                    inCategory.some((p) => same(p.name, r.name)))) && (
                  <p className="text-xs text-destructive">
                    {r.error ?? 'Já existe nesta categoria.'}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => addRow()}
            >
              <Plus /> Linha
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPasting((v) => !v)}
            >
              <ClipboardPaste /> Colar lista
            </Button>
          </div>
          {pasting && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <Textarea
                autoFocus
                rows={5}
                placeholder={
                  'Um por linha, preço no final:\nCoca-Cola lata 6,00\nSuco de laranja 9,50'
                }
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!pasteText.trim()}
                onClick={() => {
                  const items = parsePastedOptions(pasteText).map((o) =>
                    emptyRow(
                      o.name,
                      o.priceCents ? centsToInput(o.priceCents) : '',
                    ),
                  );
                  setRows((rs) => [
                    ...rs.filter((r) => r.name.trim() || r.priceText),
                    ...items,
                  ]);
                  setPasteText('');
                  setPasting(false);
                }}
              >
                Adicionar à lista
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={filled.length === 0 || save.isPending}
            onClick={submit}
          >
            {save.isPending && <Loader2 className="animate-spin" />}
            Salvar {filled.length || ''}{' '}
            {filled.length === 1 ? 'item' : 'itens'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Escolha do tipo de item ----------

const choices: {
  key: QuickKind | 'burger' | 'pizza' | 'simple';
  icon: LucideIcon;
  title: string;
  description: string;
}[] = [
  {
    key: 'burger',
    icon: ChefHat,
    title: 'Lanche',
    description: 'Ingredientes Sem/Pouco/Extra, adicionais e combo',
  },
  {
    key: 'pizza',
    icon: Pizza,
    title: 'Pizza',
    description: 'Tamanhos, sabores por faixa de preço e bordas',
  },
  {
    key: 'drink',
    icon: CupSoda,
    title: 'Bebidas',
    description: 'Várias de uma vez, só nome e preço',
  },
  {
    key: 'side',
    icon: Soup,
    title: 'Porções e acompanhamentos',
    description: 'Batata, petiscos, arroz… em lista',
  },
  {
    key: 'simple',
    icon: Package,
    title: 'Outro produto',
    description: 'Formulário completo (sobremesa, prato, por quilo)',
  },
];

/** "O que vamos cadastrar?": cada tipo abre o jeito mais rápido de cadastrar. */
export function NewItemDialog({
  open,
  onClose,
  onQuick,
  onSimple,
}: {
  open: boolean;
  onClose: () => void;
  onQuick: (kind: QuickKind) => void;
  onSimple: () => void;
}) {
  const navigate = useNavigate();

  function pick(key: (typeof choices)[number]['key']) {
    onClose();
    if (key === 'burger') navigate('/produtos/montar');
    else if (key === 'pizza') navigate('/produtos/pizzaria');
    else if (key === 'simple') onSimple();
    else onQuick(key);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>O que vamos cadastrar?</DialogTitle>
          <DialogDescription>
            Cada tipo abre o caminho mais curto até o cardápio do garçom.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {choices.map(({ key, icon: Icon, title, description }) => (
            <button
              key={key}
              type="button"
              onClick={() => pick(key)}
              className={cn(
                'flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition',
                'hover:border-primary/50 hover:bg-accent/50 active:scale-[0.99]',
                key === 'simple' && 'sm:col-span-2',
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">
                  {description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
