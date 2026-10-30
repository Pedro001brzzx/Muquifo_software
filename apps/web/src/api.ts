import {
  type AddCashMovementInput,
  type AddOrderItemInput,
  type AddPaymentInput,
  APPROVAL_HEADER,
  type ApiError,
  type AuthStatus,
  type CancelOrderInput,
  type CancelPaymentInput,
  type CancelTabInput,
  type CashSession,
  type Category,
  type CloseCashInput,
  type CreateCategoryInput,
  type CreateDiningTableInput,
  type CreateIngredientInput,
  type CreateOptionGroupInput,
  type CreateOrderInput,
  type CreatePizzaFlavorInput,
  type CreatePizzaTierInput,
  type CreateProductInput,
  type CreateUserInput,
  type CurrentCash,
  type CurrentUser,
  type Dashboard,
  type DiningTable,
  errorCodes,
  type Health,
  IDEMPOTENCY_HEADER,
  type Ingredient,
  type LoginInput,
  type Network,
  type OpenCashInput,
  type OpenTabInput,
  type OptionGroup,
  type Order,
  type PizzaFlavor,
  type PizzaTier,
  type Product,
  type ProductionSector,
  type ProductStatusFilter,
  type PublicMenu,
  type PublishAddressInput,
  type RecoverInput,
  type Restaurant,
  type Session,
  type SetupInput,
  type SetupResult,
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
  type UpdateRestaurantInput,
  type UpdateUserInput,
  type User,
} from '@muquifo/contracts';
import { newIdempotencyKey } from './lib/idempotency';

/**
 * Instalado, o app é servido pela própria API (mesma origem). Em
 * desenvolvimento o Vite roda na 5173 e a API na 3000 da mesma máquina.
 */
export const API_URL: string =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV
    ? `${location.protocol}//${location.hostname}:3000/api/v1`
    : `${location.origin}/api/v1`);

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

// ---------- Sessão (PIN) ----------

const TOKEN_KEY = 'muquifo.session';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let authToken = readToken();
const tokenListeners = new Set<(token: string | null) => void>();

export const getAuthToken = () => authToken;

/** Guarda (ou apaga) a sessão deste aparelho e avisa quem estiver ouvindo. */
export function setAuthToken(token: string | null) {
  authToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Sem armazenamento: a sessão vale até fechar a aba.
  }
  for (const listen of tokenListeners) listen(token);
}

export function onAuthTokenChange(listen: (token: string | null) => void) {
  tokenListeners.add(listen);
  return () => {
    tokenListeners.delete(listen);
  };
}

/**
 * Pede o PIN de um dono/gerente na tela (ações sensíveis feitas por quem não
 * é dono). Devolve o PIN digitado, ou nulo se a pessoa desistiu.
 */
export type ApprovalPrompt = (request: {
  action: string;
  error?: string;
}) => Promise<string | null>;

let approvalPrompt: ApprovalPrompt | null = null;
export function setApprovalPrompt(prompt: ApprovalPrompt | null) {
  approvalPrompt = prompt;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { idempotent?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  // Uma chave por ação do usuário; os reenvios por falha de rede usam a mesma,
  // então a API nunca executa a operação duas vezes (RNF03).
  if (options.idempotent) headers[IDEMPOTENCY_HEADER] = newIdempotencyKey();
  const attempts = options.idempotent ? NETWORK_RETRIES + 1 : 1;
  let action = '';

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
    if (res.ok) return data as T;

    const error = new ApiRequestError(res.status, data as ApiError | null);
    // Sessão expirou ou foi encerrada (PIN trocado, desativado): volta à entrada.
    if (res.status === 401 && error.code === errorCodes.unauthorized) {
      if (authToken) setAuthToken(null);
      throw error;
    }
    // Ação sensível: pede o PIN do gerente e repete com a mesma chave.
    const needsApproval =
      res.status === 403 &&
      (error.code === errorCodes.approvalRequired ||
        (error.code === errorCodes.invalidPin && APPROVAL_HEADER in headers));
    if (needsApproval && approvalPrompt) {
      if (error.code === errorCodes.approvalRequired) {
        action = (error.body?.details as { action?: string })?.action ?? '';
      }
      const pin = await approvalPrompt({
        action,
        error: error.code === errorCodes.invalidPin ? error.message : undefined,
      });
      if (pin) {
        headers[APPROVAL_HEADER] = pin;
        attempt = 0;
        continue;
      }
    }
    throw error;
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

  authStatus: () => request<AuthStatus>('GET', '/auth/status'),
  setup: (input: SetupInput) =>
    request<SetupResult>('POST', '/auth/setup', input),
  login: (input: LoginInput) => request<Session>('POST', '/auth/login', input),
  recover: (input: RecoverInput) =>
    request<Session>('POST', '/auth/recover', input),
  me: () => request<CurrentUser>('GET', '/auth/me'),
  logout: () => request<null>('POST', '/auth/logout'),
  users: () => request<User[]>('GET', '/users'),
  createUser: (input: CreateUserInput) =>
    request<User>('POST', '/users', input),
  updateUser: (id: string, input: UpdateUserInput) =>
    request<User>('PATCH', `/users/${id}`, input),

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

  cashCurrent: () => request<CurrentCash>('GET', '/cash/current'),
  cashSessions: (limit = 20) =>
    request<CashSession[]>('GET', `/cash/sessions?limit=${limit}`),
  openCash: (input: OpenCashInput) =>
    request<CashSession>('POST', '/cash/sessions', input, idem),
  addCashMovement: (id: string, input: AddCashMovementInput) =>
    request<CashSession>('POST', `/cash/sessions/${id}/movements`, input, idem),
  closeCash: (id: string, input: CloseCashInput) =>
    request<CashSession>('POST', `/cash/sessions/${id}/close`, input, idem),
  dashboard: (date?: string) =>
    request<Dashboard>('GET', `/dashboard${query({ date })}`),

  restaurant: () => request<Restaurant>('GET', '/restaurant'),
  updateRestaurant: (input: UpdateRestaurantInput) =>
    request<Restaurant>('PATCH', '/restaurant', input),

  /** Cardápio público do QR code. */
  publicMenu: () => request<PublicMenu>('GET', '/menu'),
  network: () => request<Network>('GET', '/network'),
  publishAddress: (input: PublishAddressInput) =>
    request<Network>('PUT', '/network/published', input),
  acknowledgeAddressChange: () =>
    request<Network>('DELETE', '/network/pending-change'),

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
  authStatus: ['auth-status'],
  me: ['auth-me'],
  users: ['users'],
  sectors: ['sectors'],
  categories: ['categories'],
  products: ['products'],
  optionGroups: ['option-groups'],
  ingredients: ['ingredients'],
  pizzaTiers: ['pizza-tiers'],
  pizzaFlavors: ['pizza-flavors'],
  tables: ['tables'],
  publicMenu: ['public-menu'],
  restaurant: ['restaurant'],
  cash: ['cash'],
  dashboard: (date: string) => ['dashboard', date],
  network: ['network'],
  tabs: (status?: TabStatus) => ['tabs', status ?? 'all'],
  tab: (id: string) => ['tab', id],
} as const;
