import { errorCodes } from '@muquifo/contracts';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app-exception.js';
import type { tabs } from '../db/schema.js';

type TabRow = typeof tabs.$inferSelect;

const tabStatusLabel: Record<TabRow['status'], string> = {
  open: 'aberta',
  closing: 'em fechamento',
  closed: 'fechada',
  canceled: 'cancelada',
};

/**
 * `order`: só comanda aberta recebe pedidos.
 * `settle`: cancelamentos, pagamentos e encerramento valem também em fechamento.
 */
export function assertTabAccepts(
  tab: TabRow,
  action: 'order' | 'settle',
): void {
  const allowed = action === 'order' ? ['open'] : ['open', 'closing'];
  if (!allowed.includes(tab.status)) {
    throw new AppException(
      HttpStatus.CONFLICT,
      errorCodes.tabNotOpen,
      `Comanda ${tab.code} está ${tabStatusLabel[tab.status]}; a operação não é permitida.`,
      { tabId: tab.id, status: tab.status },
    );
  }
}
