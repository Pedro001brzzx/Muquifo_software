import { errorCodes } from '@muquifo/contracts';
import { toast } from 'sonner';
import { ApiRequestError } from '@/api';

const titles: Record<string, string> = {
  [errorCodes.validation]: 'Dados inválidos',
  [errorCodes.notFound]: 'Não encontrado',
  [errorCodes.conflict]: 'Já existe um cadastro igual',
  [errorCodes.versionConflict]: 'Alterado em outro aparelho',
  [errorCodes.tabNotOpen]: 'Comanda não está aberta',
  [errorCodes.orderNotEditable]: 'Pedido não pode ser alterado',
  [errorCodes.emptyOrder]: 'Pedido sem itens',
  [errorCodes.productUnavailable]: 'Produto indisponível',
  [errorCodes.priceChanged]: 'Preço alterado',
  [errorCodes.idempotencyKeyReused]: 'Operação duplicada',
};

export function errorTitle(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 0) return 'Sem conexão com o servidor';
    return (error.code && titles[error.code]) ?? 'Não foi possível concluir';
  }
  return 'Erro inesperado';
}

/** Primeira mensagem de campo em VALIDATION_FAILED, que é mais útil que "Dados inválidos.". */
export function errorDescription(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const details = error.body?.details;
    if (
      error.code === errorCodes.validation &&
      Array.isArray(details) &&
      details[0]?.message
    ) {
      const { path, message } = details[0] as {
        path?: string;
        message: string;
      };
      return path ? `${path}: ${message}` : message;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function toastError(error: unknown) {
  toast.error(errorTitle(error), { description: errorDescription(error) });
}

export const isApiError = (error: unknown, code: string) =>
  error instanceof ApiRequestError && error.code === code;
