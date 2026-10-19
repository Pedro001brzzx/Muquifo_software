export { formatCents } from '@muquifo/contracts';

/** "agora", "há 12 min", "há 2 h 05", "há 3 d 4 h". */
export function elapsed(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `há ${d} d${h % 24 ? ` ${h % 24} h` : ''}`;
  }
  return `há ${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatQuantity(q: number): string {
  return Number.isInteger(q)
    ? String(q)
    : q.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export const tableLabel = (n: number) => String(n).padStart(2, '0');
