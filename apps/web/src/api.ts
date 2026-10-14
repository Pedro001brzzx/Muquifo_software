import type {
  ApiError,
  Category,
  CreateCategoryInput,
  CreateDiningTableInput,
  CreateProductInput,
  DiningTable,
  Health,
  Product,
  ProductionSector,
  UpdateProductAvailabilityInput,
} from '@muquifo/contracts';

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
        `Falha de comunicação (HTTP ${status || 'sem resposta'})`,
    );
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers:
        body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, null);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, data as ApiError | null);
  return data as T;
}

export const api = {
  health: () => request<Health>('GET', '/health'),
  sectors: () => request<ProductionSector[]>('GET', '/sectors'),
  categories: () => request<Category[]>('GET', '/categories'),
  createCategory: (input: CreateCategoryInput) =>
    request<Category>('POST', '/categories', input),
  products: () => request<Product[]>('GET', '/products'),
  createProduct: (input: CreateProductInput) =>
    request<Product>('POST', '/products', input),
  setAvailability: (id: string, input: UpdateProductAvailabilityInput) =>
    request<Product>('PATCH', `/products/${id}/availability`, input),
  tables: () => request<DiningTable[]>('GET', '/tables'),
  createTable: (input: CreateDiningTableInput) =>
    request<DiningTable>('POST', '/tables', input),
};
