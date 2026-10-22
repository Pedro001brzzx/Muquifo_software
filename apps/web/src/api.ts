import {
  type AddOrderItemInput,
  type AddPaymentInput,
  type ApiError,
  type CancelOrderInput,
  type CancelPaymentInput,
  type CancelTabInput,
  type Category,
  type CreateCategoryInput,
  type CreateDiningTableInput,
  type CreateIngredientInput,
  type CreateOptionGroupInput,
  type CreateOrderInput,
  type CreatePizzaFlavorInput,
  type CreatePizzaTierInput,
  type CreateProductInput,
  type DiningTable,
  type Health,
  IDEMPOTENCY_HEADER,
  type Ingredient,
  type OpenTabInput,
  type OptionGroup,
  type Order,
  type PizzaFlavor,
  type PizzaTier,
  type Product,
  type ProductionSector,
  type ProductStatusFilter,
  type TabDetail,
  type TabStatus,
  type TabSummary,
  type UpdateCategoryInput,
  type UpdateIngredientInput,
  type UpdateOptionGroupInput,
  type UpdatePizzaFlavorInput,
  type UpdatePizzaTierInput,
  type UpdateProductAvailabilityInput,
  type UpdateProductInput,
} from '@muquifo/contracts';
import { newIdempotencyKey } from './lib/idempotency';

export const API_URL: string =
  import.meta.env.VITE_API_URL ??
  `${location.protocol}//${location.hostname}:3000/api/v1`;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(
      body?.message ??
        (status === 0
          ? 'Sem resposta do servidor. Verifique a rede.'
          : `Falha de comunicação (HTTP ${status}).`),
    );
  }

  get code(): string | undefined {
    return this.body?.code;
  }
}

const NETWORK_RETRIES = 2;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { idempotent?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  // Uma chave por ação do usuário; os reenvios por falha de rede usam a mesma,
  // então a API nunca executa a operação duas vezes (RNF03).
  if (options.idempotent) headers[IDEMPOTENCY_HEADER] = newIdempotencyKey();
  const attempts = options.idempotent ? NETWORK_RETRIES + 1 : 1;

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      throw new ApiRequestError(0, null);
    }
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new ApiRequestError(res.status, data as ApiError | null);
    return data as T;
  }
}

const query = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => !!e[1]),
  ).toString();
  return q ? `?${q}` : '';
};

const idem = { idempotent: true };

export const api = {
  health: () => request<Health>('GET', '/health'),

  sectors: () => request<ProductionSector[]>('GET', '/sectors'),
  categories: () => request<Category[]>('GET', '/categories'),
  createCategory: (input: CreateCategoryInput) =>
    request<Category>('POST', '/categories', input),
  updateCategory: (id: string, input: UpdateCategoryInput) =>
    request<Category>('PATCH', `/categories/${id}`, input),
  /** Sem filtro: só ativos (o cardápio). A administração usa `status: 'all'`. */
  products: (filter: { status?: ProductStatusFilter } = {}) =>
    request<Product[]>('GET', `/products${query(filter)}`),
  createProduct: (input: CreateProductInput) =>
    request<Product>('POST', '/products', input),
  updateProduct: (id: string, input: UpdateProductInput) =>
    request<Product>('PATCH', `/products/${id}`, input),

  /** Padrão: só grupos ativos. A administração usa `status: 'all'`. */
  optionGroups: (filter: { status?: 'active' | 'archived' | 'all' } = {}) =>
    request<OptionGroup[]>('GET', `/option-groups${query(filter)}`),
  createOptionGroup: (input: CreateOptionGroupInput) =>
    request<OptionGroup>('POST', '/option-groups', input),
  updateOptionGroup: (id: string, input: UpdateOptionGroupInput) =>
    request<OptionGroup>('PATCH', `/option-groups/${id}`, input),

  ingredients: (filter: { status?: 'active' | 'archived' | 'all' } = {}) =>
    request<Ingredient[]>('GET', `/ingredients${query(filter)}`),
  createIngredient: (input: CreateIngredientInput) =>
    request<Ingredient>('POST', '/ingredients', input),
  updateIngredient: (id: string, input: UpdateIngredientInput) =>
    request<Ingredient>('PATCH', `/ingredients/${id}`, input),
  /** Padrão: só ativos. A pizzaria usa `status: 'all'`. */
  pizzaTiers: (filter: { status?: 'active' | 'archived' | 'all' } = {}) =>
    request<PizzaTier[]>('GET', `/pizza/tiers${query(filter)}`),
  createPizzaTier: (input: CreatePizzaTierInput) =>
    request<PizzaTier>('POST', '/pizza/tiers', input),
  updatePizzaTier: (id: string, input: UpdatePizzaTierInput) =>
    request<PizzaTier>('PATCH', `/pizza/tiers/${id}`, input),
  pizzaFlavors: (filter: { status?: 'active' | 'archived' | 'all' } = {}) =>
    request<PizzaFlavor[]>('GET', `/pizza/flavors${query(filter)}`),
  createPizzaFlavor: (input: CreatePizzaFlavorInput) =>
    request<PizzaFlavor>('POST', '/pizza/flavors', input),
  updatePizzaFlavor: (id: string, input: UpdatePizzaFlavorInput) =>
    request<PizzaFlavor>('PATCH', `/pizza/flavors/${id}`, input),

  setAvailability: (id: string, input: UpdateProductAvailabilityInput) =>
    request<Product>('PATCH', `/products/${id}/availability`, input),

  tables: () => request<DiningTable[]>('GET', '/tables'),
  createTable: (input: CreateDiningTableInput) =>
    request<DiningTable>('POST', '/tables', input),

  tabs: (filter: { status?: TabStatus; tableId?: string } = {}) =>
    request<TabSummary[]>('GET', `/tabs${query(filter)}`),
  tab: (id: string) => request<TabDetail>('GET', `/tabs/${id}`),
  openTab: (input: OpenTabInput) =>
    request<TabDetail>('POST', '/tabs', input, idem),

  createOrder: (input: CreateOrderInput) =>
    request<Order>('POST', '/orders', input, idem),
  addItem: (orderId: string, input: AddOrderItemInput) =>
    request<Order>('POST', `/orders/${orderId}/items`, input, idem),
  removeItem: (orderId: string, itemId: string) =>
    request<Order>(
      'DELETE',
      `/orders/${orderId}/items/${itemId}`,
      undefined,
      idem,
    ),
  submitOrder: (orderId: string, version: number) =>
    request<Order>('POST', `/orders/${orderId}/submit`, { version }, idem),
  cancelOrder: (orderId: string, input: CancelOrderInput) =>
    request<Order>('POST', `/orders/${orderId}/cancellations`, input, idem),

  addPayment: (tabId: string, input: AddPaymentInput) =>
    request<TabDetail>('POST', `/tabs/${tabId}/payments`, input, idem),
  cancelPayment: (
    tabId: string,
    paymentId: string,
    input: CancelPaymentInput,
  ) =>
    request<TabDetail>(
      'POST',
      `/tabs/${tabId}/payments/${paymentId}/cancellations`,
      input,
      idem,
    ),
  closeTab: (tabId: string, version: number) =>
    request<TabDetail>('POST', `/tabs/${tabId}/close`, { version }, idem),
  /** Libera a mesa: cancela comanda sem consumo. */
  cancelTab: (tabId: string, input: CancelTabInput) =>
    request<TabDetail>('POST', `/tabs/${tabId}/cancellations`, input, idem),
};

export const queryKeys = {
  health: ['health'],
  sectors: ['sectors'],
  categories: ['categories'],
  products: ['products'],
  optionGroups: ['option-groups'],
  ingredients: ['ingredients'],
  pizzaTiers: ['pizza-tiers'],
  pizzaFlavors: ['pizza-flavors'],
  tables: ['tables'],
  tabs: (status?: TabStatus) => ['tabs', status ?? 'all'],
  tab: (id: string) => ['tab', id],
} as const;
