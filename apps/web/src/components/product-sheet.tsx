import {
  type Category,
  errorCodes,
  formatCents,
  type Product,
  parseCents,
  type UpdateProductInput,
} from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, Loader2, Plus, RotateCw } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, api, queryKeys } from '@/api';
import { Field, FormDialog } from '@/components/form-dialog';
import { centsToInput, MoneyInput } from '@/components/money-input';
import { GroupPicker, OptionGroupSheet } from '@/components/option-groups';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

const NO_SECTOR = 'none';

interface FormState {
  name: string;
  code: string;
  description: string;
  categoryId: string;
  sectorId: string;
  priceText: string;
  allowFractional: boolean;
  available: boolean;
  optionGroupIds: string[];
}

type FieldName = 'name' | 'code' | 'description' | 'categoryId' | 'price';
type Errors = Partial<Record<FieldName, string>>;

function initialState(
  product: Product | null,
  defaultCategoryId: string,
): FormState {
  return product
    ? {
        name: product.name,
        code: product.code ?? '',
        description: product.description ?? '',
        categoryId: product.categoryId,
        sectorId: product.sectorId ?? NO_SECTOR,
        priceText: centsToInput(product.priceCents),
        allowFractional: product.allowFractional,
        available: product.available,
        optionGroupIds: product.optionGroupIds,
      }
    : {
        name: '',
        code: '',
        description: '',
        categoryId: defaultCategoryId,
        sectorId: NO_SECTOR,
        priceText: '',
        allowFractional: false,
        available: true,
        optionGroupIds: [],
      };
}

/** Caminho do erro da API (`priceCents`, `details.field`) para o campo do formulário. */
const fieldFromApi = (path: string | undefined): FieldName | undefined =>
  path === 'priceCents'
    ? 'price'
    : path === 'name' ||
        path === 'code' ||
        path === 'description' ||
        path === 'categoryId'
      ? path
      : undefined;

/**
 * Cria (`product` nulo) ou edita um produto. Na edição só os campos alterados
 * são enviados, junto com a `version` que o formulário carregou.
 */
export function ProductSheet({
  open,
  product,
  defaultCategoryId,
  onClose,
}: {
  open: boolean;
  product: Product | null;
  defaultCategoryId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: queryKeys.categories,
    queryFn: api.categories,
  });
  const sectors = useQuery({
    queryKey: queryKeys.sectors,
    queryFn: api.sectors,
  });
  const activeCategories = (categories.data ?? []).filter(
    (c) => c.active || c.id === product?.categoryId,
  );

  const [form, setForm] = useState<FormState>(() =>
    initialState(product, defaultCategoryId ?? ''),
  );
  const [base, setBase] = useState<Product | null>(product);
  const [errors, setErrors] = useState<Errors>({});
  const [stale, setStale] = useState(false);
  const [newCategory, setNewCategory] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const selectedCategory = categories.data?.find(
    (c) => c.id === form.categoryId,
  );

  // Reinicia o formulário a cada abertura (de propósito, não a cada mudança de categorias).
  useEffect(() => {
    if (!open) return;
    setForm(
      initialState(
        product,
        defaultCategoryId ?? activeCategories.find((c) => c.active)?.id ?? '',
      ),
    );
    setBase(product);
    setErrors({});
    setStale(false);
  }, [open, product]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    const field = key === 'priceText' ? 'price' : key;
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const priceCents = parseCents(form.priceText);
  const priceChanged =
    base !== null && priceCents !== null && priceCents !== base.priceCents;

  const save = useMutation({
    mutationFn: async () => {
      const values = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        description: form.description.trim() || null,
        categoryId: form.categoryId,
        sectorId: form.sectorId === NO_SECTOR ? null : form.sectorId,
        priceCents: priceCents ?? 0,
        allowFractional: form.allowFractional,
        available: form.available,
      };
      if (!base) {
        return api.createProduct({
          ...values,
          optionGroupIds: form.optionGroupIds,
        });
      }

      const changes: UpdateProductInput = { version: base.version };
      for (const [key, value] of Object.entries(values) as [
        keyof typeof values,
        unknown,
      ][]) {
        if (value !== (base[key] ?? null)) {
          (changes as Record<string, unknown>)[key] = value;
        }
      }
      if (form.optionGroupIds.join() !== base.optionGroupIds.join()) {
        changes.optionGroupIds = form.optionGroupIds;
      }
      if (Object.keys(changes).length === 1) return base; // nada mudou
      return api.updateProduct(base.id, changes);
    },
    onSuccess: (saved) => {
      toast.success(
        base
          ? `${saved.name} atualizado`
          : `${saved.name} adicionado ao cardápio`,
        { description: formatCents(saved.priceCents) },
      );
      void qc.invalidateQueries({ queryKey: queryKeys.products });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        if (error.code === errorCodes.versionConflict) {
          setStale(true);
          return;
        }
        const details = error.body?.details;
        if (error.code === errorCodes.conflict && details) {
          const field = fieldFromApi((details as { field?: string }).field);
          if (field) return setErrors({ [field]: error.message });
        }
        if (error.code === errorCodes.categoryArchived) {
          return setErrors({ categoryId: error.message });
        }
        if (error.code === errorCodes.validation && Array.isArray(details)) {
          const next: Errors = {};
          for (const d of details as { path?: string; message: string }[]) {
            const field = fieldFromApi(d.path);
            if (field) next[field] = d.message;
          }
          if (Object.keys(next).length) return setErrors(next);
        }
      }
      toastError(error);
    },
  });

  /** Recarrega o produto atual do servidor e reaplica no formulário. */
  async function reload() {
    if (!base) return;
    const list = await qc.fetchQuery({
      queryKey: [...queryKeys.products, 'admin'],
      queryFn: () => api.products({ status: 'all' }),
    });
    const fresh = list.find((p) => p.id === base.id);
    if (fresh) {
      setBase(fresh);
      setForm(initialState(fresh, fresh.categoryId));
    }
    setStale(false);
    setErrors({});
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!form.name.trim()) next.name = 'Informe o nome.';
    if (!form.categoryId) next.categoryId = 'Escolha a categoria.';
    if (priceCents === null)
      next.price = 'Preço inválido. Use o formato 12,50.';
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-lg">
        <form onSubmit={onSubmit} className="flex h-full flex-col">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>{base ? 'Editar produto' : 'Novo produto'}</SheetTitle>
            <SheetDescription>
              {base
                ? `Versão ${base.version} · alterado em ${new Date(base.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
                : 'Cadastre um item do cardápio.'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {stale && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Alterado em outro aparelho</AlertTitle>
                <AlertDescription>
                  <p>
                    Este produto mudou depois que você abriu o formulário.
                    Recarregue para ver a versão atual e refaça a alteração.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={reload}
                  >
                    <RotateCw /> Recarregar produto
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <Field label="Nome" htmlFor="p-name" error={errors.name}>
              <Input
                id="p-name"
                autoFocus={!base}
                maxLength={120}
                placeholder="Ex.: X-búrguer"
                value={form.name}
                aria-invalid={!!errors.name || undefined}
                onChange={(e) => set('name', e.target.value)}
              />
            </Field>

            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field
                label="Preço"
                htmlFor="p-price"
                error={errors.price}
                hint={
                  priceChanged && base
                    ? `Antes ${formatCents(base.priceCents)}. Itens já lançados mantêm o preço da venda.`
                    : form.allowFractional
                      ? 'Preço por quilo.'
                      : undefined
                }
              >
                <MoneyInput
                  id="p-price"
                  value={form.priceText}
                  onChange={(v) => set('priceText', v)}
                  invalid={!!errors.price}
                />
              </Field>
              <Field
                label="Código (opcional)"
                htmlFor="p-code"
                error={errors.code}
                hint="Busca rápida no caixa."
              >
                <Input
                  id="p-code"
                  maxLength={20}
                  placeholder="Ex.: XB01"
                  className="h-11 font-mono uppercase"
                  value={form.code}
                  aria-invalid={!!errors.code || undefined}
                  onChange={(e) =>
                    set('code', e.target.value.toUpperCase().replace(/\s/g, ''))
                  }
                />
              </Field>
            </div>

            <Field
              label={
                <span className="flex w-full items-center justify-between">
                  Categoria
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs font-normal text-primary hover:underline"
                    onClick={() => setNewCategory(true)}
                  >
                    <Plus className="size-3" /> Nova categoria
                  </button>
                </span>
              }
              error={errors.categoryId}
            >
              <Select
                value={form.categoryId}
                onValueChange={(v) => set('categoryId', v)}
              >
                <SelectTrigger
                  className="w-full"
                  aria-invalid={!!errors.categoryId || undefined}
                >
                  <SelectValue placeholder="Escolha a categoria" />
                </SelectTrigger>
                <SelectContent>
                  {activeCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {!c.active && ' (arquivada)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Setor de produção"
              hint="Para onde o pedido vai ser preparado."
            >
              <Select
                value={form.sectorId}
                onValueChange={(v) => set('sectorId', v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SECTOR}>
                    Nenhum (pronta entrega, ex.: lata)
                  </SelectItem>
                  {sectors.data?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Descrição (opcional)"
              htmlFor="p-description"
              error={errors.description}
              hint={`${form.description.length}/500`}
            >
              <Textarea
                id="p-description"
                rows={3}
                maxLength={500}
                placeholder="Ingredientes, tamanho, observações para o garçom"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>

            <Field
              label="Complementos"
              hint="Marque os grupos que o garçom deve oferecer com este produto, na ordem em que aparecem."
            >
              <GroupPicker
                value={form.optionGroupIds}
                onChange={(ids) => set('optionGroupIds', ids)}
                inherited={selectedCategory?.optionGroupIds}
                inheritedFrom={selectedCategory?.name}
                onCreate={() => setNewGroup(true)}
              />
            </Field>

            <div className="divide-y rounded-lg border">
              <ToggleRow
                title="Vendido por peso"
                description="Permite quantidade fracionada (ex.: 0,350 kg)."
                checked={form.allowFractional}
                onChange={(v) => set('allowFractional', v)}
              />
              <ToggleRow
                title="Disponível para venda"
                description="Desligue quando acabar; o produto continua no cardápio como esgotado."
                checked={form.available}
                onChange={(v) => set('available', v)}
              />
            </div>

            {base && !base.active && (
              <Alert>
                <Info />
                <AlertDescription>
                  Este produto está arquivado e não aparece no cardápio. Use
                  “Restaurar” na lista para voltar a vendê-lo.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <SheetFooter className="flex-row justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || stale}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {base ? 'Salvar alterações' : 'Cadastrar produto'}
            </Button>
          </SheetFooter>
        </form>

        <CategoryFormDialog
          open={newCategory}
          category={null}
          onClose={() => setNewCategory(false)}
          onSaved={(c) => set('categoryId', c.id)}
        />
        <OptionGroupSheet
          open={newGroup}
          group={null}
          onClose={() => setNewGroup(false)}
          onSaved={(g) =>
            setForm((f) => ({
              ...f,
              optionGroupIds: [...f.optionGroupIds, g.id],
            }))
          }
        />
      </SheetContent>
    </Sheet>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 p-3">
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** Cria ou renomeia categoria (nome e ordem de exibição). */
export function CategoryFormDialog({
  open,
  category,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: Category | null;
  onClose: () => void;
  onSaved?: (c: Category) => void;
}) {
  const qc = useQueryClient();
  const [groupIds, setGroupIds] = useState<string[]>([]);
  useEffect(() => {
    if (open) setGroupIds(category?.optionGroupIds ?? []);
  }, [open, category]);
  const save = useMutation({
    mutationFn: (input: {
      name: string;
      sortOrder: number;
      optionGroupIds: string[];
    }) =>
      category
        ? api.updateCategory(category.id, input)
        : api.createCategory(input),
    onSuccess: (c) => {
      toast.success(
        category
          ? `Categoria ${c.name} atualizada`
          : `Categoria ${c.name} criada`,
      );
      void qc.invalidateQueries({ queryKey: queryKeys.categories });
      onSaved?.(c);
      onClose();
    },
    onError: toastError,
  });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={category ? 'Editar categoria' : 'Nova categoria'}
      description="A ordem define a sequência no cardápio do garçom."
      pending={save.isPending}
      onSubmit={(d) =>
        save.mutate({
          name: String(d.get('name')).trim(),
          sortOrder: Number(d.get('sortOrder') || 0),
          optionGroupIds: groupIds,
        })
      }
    >
      <Field label="Nome" htmlFor="c-name">
        <Input
          id="c-name"
          name="name"
          required
          maxLength={120}
          autoFocus
          defaultValue={category?.name}
          placeholder="Ex.: Sobremesas"
        />
      </Field>
      <Field label="Ordem de exibição" htmlFor="c-order">
        <Input
          id="c-order"
          name="sortOrder"
          type="number"
          min={0}
          defaultValue={category?.sortOrder ?? 0}
        />
      </Field>
      <Field
        label="Complementos da categoria"
        hint="Valem para todos os produtos desta categoria, inclusive os que forem cadastrados depois."
      >
        <div className="max-h-56 overflow-y-auto">
          <GroupPicker value={groupIds} onChange={setGroupIds} />
        </div>
      </Field>
    </FormDialog>
  );
}
