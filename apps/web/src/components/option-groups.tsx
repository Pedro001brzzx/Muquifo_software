import {
  errorCodes,
  formatCents,
  type OptionGroup,
  parseCents,
} from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ClipboardPaste,
  GitBranch,
  Loader2,
  Plus,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, api, queryKeys } from '@/api';
import { Field } from '@/components/form-dialog';
import { centsToInput } from '@/components/money-input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toastError } from '@/lib/errors';
import { cn } from '@/lib/utils';

/** "Obrigatório · escolha 1", "Opcional · até 5", "Obrigatório · de 1 a 3". */
export function ruleLabel(g: { minSelect: number; maxSelect: number }) {
  if (g.minSelect === 0) {
    return g.maxSelect === 1
      ? 'Opcional · até 1'
      : `Opcional · até ${g.maxSelect}`;
  }
  return g.minSelect === g.maxSelect
    ? `Obrigatório · escolha ${g.minSelect}`
    : `Obrigatório · de ${g.minSelect} a ${g.maxSelect}`;
}

/** Explicação em português da regra, para o administrador conferir. */
function ruleSentence(min: number, max: number) {
  if (max < min) return 'O máximo precisa ser maior ou igual ao mínimo.';
  const many = (n: number) => (n === 1 ? '1 opção' : `${n} opções`);
  if (min === 0) {
    return `O garçom pode pular este grupo ou escolher até ${many(max)}.`;
  }
  return min === max
    ? `O garçom precisa escolher exatamente ${many(min)}.`
    : `O garçom precisa escolher de ${min} a ${max} opções.`;
}

// Ex.: ponto da carne · borda · adicionais.
const presets = [
  { label: 'Escolha 1 obrigatória', min: 1, max: 1 },
  { label: 'Opcional, só 1', min: 0, max: 1 },
  { label: 'Opcional, vários', min: 0, max: 5 },
];

interface Row {
  key: number;
  id?: string;
  name: string;
  priceText: string;
  available: boolean;
  /** Grupo que esta opção abre (ex.: Combo → Bebida do combo). */
  childGroupId: string | null;
  showChild: boolean;
}

let nextKey = 1;
const blankRow = (): Row => ({
  key: nextKey++,
  name: '',
  priceText: '',
  available: true,
  childGroupId: null,
  showChild: false,
});

/** "Bacon 4,00", "Cheddar - R$ 3,50", "Sem cebola" → nome e preço. */
export function parsePastedOptions(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(
        /^(.*?)[\s;:\-–]*(?:R\$\s*)?(\d+(?:[.,]\d{1,2})?)$/i,
      );
      if (match && match[1].trim()) {
        return { name: match[1].trim(), priceCents: parseCents(match[2]) ?? 0 };
      }
      return { name: line, priceCents: 0 };
    });
}

/** Cria ou edita um grupo de complementos e sua lista de opções. */
export function OptionGroupSheet({
  open,
  group,
  onClose,
  onSaved,
}: {
  open: boolean;
  group: OptionGroup | null;
  onClose: () => void;
  onSaved?: (g: OptionGroup) => void;
}) {
  const qc = useQueryClient();
  const [base, setBase] = useState<OptionGroup | null>(group);
  const [name, setName] = useState('');
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [paste, setPaste] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const focusKey = useRef<number | null>(null);
  const allGroups = useQuery({
    queryKey: queryKeys.optionGroups,
    queryFn: () => api.optionGroups(),
    enabled: open,
  });

  function load(g: OptionGroup | null) {
    setBase(g);
    setName(g?.name ?? '');
    setMin(g?.minSelect ?? 0);
    setMax(g?.maxSelect ?? 1);
    setRows(
      g
        ? g.options.map((o) => ({
            key: nextKey++,
            id: o.id,
            name: o.name,
            priceText: o.priceCents ? centsToInput(o.priceCents) : '',
            available: o.available,
            childGroupId: o.childGroupId,
            showChild: !!o.childGroupId,
          }))
        : [blankRow()],
    );
    setPaste(null);
    setError(null);
    setStale(false);
  }

  useEffect(() => {
    if (open) load(group);
  }, [open, group]);

  useEffect(() => {
    if (focusKey.current === null) return;
    document
      .querySelector<HTMLInputElement>(
        `[data-option-row="${focusKey.current}"]`,
      )
      ?.focus();
    focusKey.current = null;
  });

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addRow(afterKey?: number) {
    const row = blankRow();
    focusKey.current = row.key;
    setRows((rs) => {
      if (afterKey === undefined) return [...rs, row];
      const i = rs.findIndex((r) => r.key === afterKey);
      return [...rs.slice(0, i + 1), row, ...rs.slice(i + 1)];
    });
  }

  function applyPaste() {
    const parsed = parsePastedOptions(paste ?? '');
    if (parsed.length === 0) return setPaste(null);
    setRows((rs) => [
      ...rs.filter((r) => r.name.trim()),
      ...parsed.map((p) => ({
        key: nextKey++,
        name: p.name,
        priceText: p.priceCents ? centsToInput(p.priceCents) : '',
        available: true,
        childGroupId: null,
        showChild: false,
      })),
    ]);
    setPaste(null);
  }

  const filled = rows.filter((r) => r.name.trim());
  const badPrice = filled.find(
    (r) => r.priceText && parseCents(r.priceText) === null,
  );

  const save = useMutation({
    mutationFn: () => {
      const optionsInput = filled.map((r) => ({
        id: r.id,
        name: r.name.trim(),
        priceCents: r.priceText ? (parseCents(r.priceText) ?? 0) : 0,
        available: r.available,
        childGroupId: r.childGroupId,
      }));
      return base
        ? api.updateOptionGroup(base.id, {
            version: base.version,
            name: name.trim(),
            minSelect: min,
            maxSelect: max,
            options: optionsInput,
          })
        : api.createOptionGroup({
            name: name.trim(),
            minSelect: min,
            maxSelect: max,
            options: optionsInput,
          });
    },
    onSuccess: (g) => {
      toast.success(
        base ? `Grupo ${g.name} atualizado` : `Grupo ${g.name} criado`,
        {
          description: `${g.options.length} opções · ${ruleLabel(g)}`,
        },
      );
      void qc.invalidateQueries({ queryKey: queryKeys.optionGroups });
      onSaved?.(g);
      onClose();
    },
    onError: (e) => {
      if (
        e instanceof ApiRequestError &&
        e.code === errorCodes.versionConflict
      ) {
        setStale(true);
        return;
      }
      if (e instanceof ApiRequestError && e.status === 422) {
        const details = e.body?.details;
        setError(
          Array.isArray(details) && details[0]?.message
            ? String(details[0].message)
            : e.message,
        );
        return;
      }
      if (e instanceof ApiRequestError && e.code === errorCodes.conflict) {
        setError(e.message);
        return;
      }
      toastError(e);
    },
  });

  async function reload() {
    const list = await qc.fetchQuery({
      queryKey: [...queryKeys.optionGroups, 'all'],
      queryFn: () => api.optionGroups({ status: 'all' }),
    });
    load(list.find((g) => g.id === base?.id) ?? null);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Dê um nome ao grupo.');
    if (filled.length === 0) return setError('Cadastre ao menos uma opção.');
    if (badPrice)
      return setError(`Preço inválido em "${badPrice.name}". Use 4,50.`);
    if (max < min)
      return setError('O máximo precisa ser maior ou igual ao mínimo.');
    if (filled.length < min) {
      return setError(
        `O grupo exige ${min} escolhas, mas tem ${filled.length} opções.`,
      );
    }
    setError(null);
    save.mutate();
  }

  const removed = base
    ? base.options.filter((o) => !rows.some((r) => r.id === o.id))
    : [];
  const used = base ? base.productCount + base.categoryCount : 0;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
        <form onSubmit={onSubmit} className="flex h-full flex-col">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>
              {base
                ? 'Editar grupo de complementos'
                : 'Novo grupo de complementos'}
            </SheetTitle>
            <SheetDescription>
              {base
                ? used > 0
                  ? `Usado em ${base.productCount} produto(s) e ${base.categoryCount} categoria(s); a mudança vale para todos.`
                  : 'Ainda não está ligado a nenhum produto.'
                : 'Crie uma vez e ligue a vários produtos ou a uma categoria inteira.'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {stale && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Alterado em outro aparelho</AlertTitle>
                <AlertDescription>
                  <p>
                    Recarregue para ver a versão atual e refaça a alteração.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={reload}
                  >
                    <RotateCw /> Recarregar grupo
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <Field label="Nome do grupo" htmlFor="g-name">
              <Input
                id="g-name"
                autoFocus={!base}
                maxLength={80}
                placeholder="Ex.: Adicionais, Ponto da carne, Borda"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <div className="space-y-3 rounded-lg border p-3">
              <div className="text-sm font-medium">Regra de escolha</div>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    size="sm"
                    variant={
                      min === p.min && max === p.max ? 'default' : 'outline'
                    }
                    onClick={() => {
                      setMin(p.min);
                      setMax(p.max);
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 items-start gap-3">
                <Field label="Mínimo" htmlFor="g-min" hint="0 = opcional">
                  <Input
                    id="g-min"
                    type="number"
                    min={0}
                    max={20}
                    value={min}
                    onChange={(e) =>
                      setMin(Math.max(0, Number(e.target.value) || 0))
                    }
                  />
                </Field>
                <Field label="Máximo" htmlFor="g-max">
                  <Input
                    id="g-max"
                    type="number"
                    min={1}
                    max={20}
                    value={max}
                    onChange={(e) =>
                      setMax(Math.max(1, Number(e.target.value) || 1))
                    }
                  />
                </Field>
              </div>
              <p
                className={cn(
                  'text-xs',
                  max < min ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {ruleSentence(min, max)}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Opções{' '}
                  <span className="text-muted-foreground">
                    ({filled.length})
                  </span>
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => setPaste(paste === null ? '' : null)}
                >
                  <ClipboardPaste /> Colar várias
                </Button>
              </div>

              {paste !== null && (
                <div className="space-y-2 rounded-lg border border-dashed p-3">
                  <Textarea
                    autoFocus
                    rows={4}
                    placeholder={
                      'Uma por linha, com preço no fim (opcional):\nBacon 4,00\nCheddar 3,50\nSem cebola'
                    }
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setPaste(null)}
                    >
                      Cancelar
                    </Button>
                    <Button type="button" size="sm" onClick={applyPaste}>
                      Adicionar {parsePastedOptions(paste).length || ''} opções
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-[minmax(0,1fr)_110px_44px_32px_32px] gap-2 px-1 text-xs text-muted-foreground">
                <span>Nome</span>
                <span>Acréscimo</span>
                <span className="text-center">Tem</span>
                <span />
                <span />
              </div>
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.key} className="space-y-1.5">
                    <div className="grid grid-cols-[minmax(0,1fr)_110px_44px_32px_32px] items-center gap-2">
                      <Input
                        data-option-row={r.key}
                        maxLength={80}
                        placeholder="Ex.: Bacon"
                        value={r.name}
                        onChange={(e) =>
                          update(r.key, { name: e.target.value })
                        }
                        onKeyDown={(e) => {
                          // Enter cria a próxima linha, para cadastrar a lista no teclado.
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addRow(r.key);
                          }
                        }}
                      />
                      <div className="relative">
                        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
                          +R$
                        </span>
                        <Input
                          inputMode="decimal"
                          placeholder="0,00"
                          className="pl-9 tabular"
                          value={r.priceText}
                          aria-invalid={
                            (r.priceText && parseCents(r.priceText) === null) ||
                            undefined
                          }
                          onChange={(e) =>
                            update(r.key, {
                              priceText: e.target.value.replace(/[^\d,.]/g, ''),
                            })
                          }
                        />
                      </div>
                      <div className="flex justify-center">
                        <Switch
                          checked={r.available}
                          onCheckedChange={(available) =>
                            update(r.key, { available })
                          }
                          aria-label={`${r.name || 'Opção'} disponível`}
                        />
                      </div>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`${r.name || 'Opção'} abre outro grupo`}
                        aria-pressed={r.showChild}
                        className={cn(r.childGroupId && 'text-primary')}
                        onClick={() =>
                          update(r.key, {
                            showChild: !r.showChild,
                            childGroupId: r.showChild ? null : r.childGroupId,
                          })
                        }
                      >
                        <GitBranch />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remover ${r.name || 'opção'}`}
                        onClick={() =>
                          setRows((rs) =>
                            rs.length === 1
                              ? [blankRow()]
                              : rs.filter((x) => x.key !== r.key),
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {r.showChild && (
                      <div className="ml-3 flex items-center gap-2 border-l-2 border-primary/40 pl-3 text-xs text-muted-foreground">
                        <span className="shrink-0">
                          Ao escolher, pedir também:
                        </span>
                        <Select
                          value={r.childGroupId ?? ''}
                          onValueChange={(v) =>
                            update(r.key, { childGroupId: v })
                          }
                        >
                          <SelectTrigger size="sm" className="min-w-0 flex-1">
                            <SelectValue placeholder="Escolha o grupo (ex.: Bebida do combo)" />
                          </SelectTrigger>
                          <SelectContent>
                            {(allGroups.data ?? [])
                              .filter((g) => g.id !== base?.id)
                              .map((g) => (
                                <SelectItem key={g.id} value={g.id}>
                                  {g.name} · {ruleLabel(g)}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => addRow()}
              >
                <Plus /> Adicionar opção
              </Button>
              <p className="text-xs text-muted-foreground">
                Dica: Enter no nome cria a próxima linha. Desligue “Tem” quando
                a opção acabar.
              </p>
              {removed.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Ao salvar, {removed.map((o) => o.name).join(', ')}{' '}
                  {removed.length === 1 ? 'sai' : 'saem'} do cardápio. Pedidos
                  antigos continuam mostrando.
                </p>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <SheetFooter className="flex-row justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || stale}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {base ? 'Salvar grupo' : 'Criar grupo'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Escolhe quais grupos ligar a um produto ou categoria. A ordem dos marcados
 * é a ordem em que o garçom vê os grupos.
 */
export function GroupPicker({
  value,
  onChange,
  inherited = [],
  inheritedFrom,
  onCreate,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Grupos que já vêm da categoria (só leitura). */
  inherited?: string[];
  inheritedFrom?: string;
  onCreate?: () => void;
}) {
  const groups = useQuery({
    queryKey: queryKeys.optionGroups,
    queryFn: () => api.optionGroups(),
  });
  const list = groups.data ?? [];
  const byId = new Map(list.map((g) => [g.id, g]));
  const inheritedGroups = inherited
    .map((id) => byId.get(id))
    .filter(Boolean) as OptionGroup[];

  if (groups.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando grupos…</p>;
  }

  return (
    <div className="space-y-2">
      {inheritedGroups.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          Já vem da categoria {inheritedFrom}:{' '}
          {inheritedGroups.map((g) => (
            <Badge key={g.id} variant="secondary" className="mr-1">
              {g.name}
            </Badge>
          ))}
        </div>
      )}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum grupo de complementos cadastrado.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {list
            .filter((g) => !inherited.includes(g.id))
            .map((g) => {
              const checked = value.includes(g.id);
              return (
                <li key={g.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={checked}
                      onChange={() =>
                        onChange(
                          checked
                            ? value.filter((id) => id !== g.id)
                            : [...value, g.id],
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {g.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {ruleLabel(g)} ·{' '}
                        {g.options
                          .slice(0, 4)
                          .map(
                            (o) =>
                              o.name +
                              (o.priceCents
                                ? ` +${formatCents(o.priceCents)}`
                                : ''),
                          )
                          .join(', ')}
                        {g.options.length > 4 && '…'}
                      </span>
                    </span>
                    {checked && (
                      <Badge variant="outline" className="tabular">
                        {value.indexOf(g.id) + 1}º
                      </Badge>
                    )}
                  </label>
                </li>
              );
            })}
        </ul>
      )}
      {onCreate && (
        <Button type="button" size="sm" variant="ghost" onClick={onCreate}>
          <Plus /> Novo grupo de complementos
        </Button>
      )}
    </div>
  );
}
