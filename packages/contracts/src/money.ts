import { z } from 'zod';

/**
 * Valores monetários trafegam e são persistidos como inteiros em centavos (RN01).
 * Nunca usar float para dinheiro.
 */
export const centsSchema = z.number().int().nonnegative().max(100_000_000);

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

/** Converte texto digitado ("12,50", "12.5", "12") em centavos; retorna null se inválido. */
export function parseCents(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
