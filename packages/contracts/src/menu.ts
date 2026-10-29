import { z } from 'zod';
import { centsSchema } from './money.js';

/**
 * Cardápio público (QR code na mesa): só o que o cliente vê, sem dados
 * internos (setor, código, versão). Itens ativos; esgotados vêm marcados.
 */

export const publicMenuExtraSchema = z.object({
  name: z.string(),
  /** Obrigatório escolher (ex.: ponto da carne). */
  required: z.boolean(),
  options: z.array(z.object({ name: z.string(), priceCents: centsSchema })),
});
export type PublicMenuExtra = z.infer<typeof publicMenuExtraSchema>;

export const publicMenuItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: centsSchema,
  /** Figura escolhida; nula = a tela deduz pelo nome. */
  icon: z.string().nullable(),
  available: z.boolean(),
  allowFractional: z.boolean(),
  /** Tamanho de pizza: até quantos sabores. */
  maxFlavors: z.number().int().nullable(),
  ingredients: z.array(z.string()),
  extras: z.array(publicMenuExtraSchema),
});
export type PublicMenuItem = z.infer<typeof publicMenuItemSchema>;

export const publicMenuSchema = z.object({
  restaurant: z.object({
    name: z.string(),
    tagline: z.string().nullable(),
    notice: z.string().nullable(),
  }),
  categories: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      items: z.array(publicMenuItemSchema),
    }),
  ),
  /** Faixas com o preço por tamanho e os sabores ativos. */
  pizzaTiers: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      prices: z.array(
        z.object({ productId: z.uuid(), priceCents: centsSchema }),
      ),
      flavors: z.array(
        z.object({
          name: z.string(),
          description: z.string().nullable(),
          available: z.boolean(),
        }),
      ),
    }),
  ),
});
export type PublicMenu = z.infer<typeof publicMenuSchema>;

const ipv4Schema = z.ipv4();

/**
 * Rede da máquina servidora: endereços para o QR e o necessário para fixar o
 * IP no roteador (reserva DHCP), além do alarme de endereço mudado.
 */
export const networkSchema = z.object({
  /** IPv4 desta máquina, o mais provável de o celular alcançar primeiro. */
  addresses: z.array(z.string()),
  /** Placa que os celulares usam (a primeira de `addresses`). */
  primary: z
    .object({
      address: z.string(),
      interfaceName: z.string(),
      /** Identificação da placa, pedida pelo roteador na reserva. */
      mac: z.string().nullable(),
      /** Endereço do roteador (página de configuração). */
      gateway: z.string().nullable(),
      /** true = o roteador empresta o IP e pode trocá-lo; null = não deu para saber. */
      dhcp: z.boolean().nullable(),
      /** Marca do roteador deduzida pela página dele (ex.: "TP-Link"). */
      router: z.string().nullable(),
    })
    .nullable(),
  /** IP que está nos QR codes impressos e nos celulares. */
  publishedAddress: z.string().nullable(),
  /** O IP publicado não é mais desta máquina: QR codes e celulares param. */
  addressChanged: z.boolean(),
  /** O dono confirmou a reserva do IP publicado no roteador. */
  addressReserved: z.boolean(),
  /**
   * Troca de IP que o servidor já seguiu sozinho e o dono ainda não viu:
   * QR codes impressos e atalhos nos celulares precisam ser refeitos.
   */
  pendingChange: z
    .object({
      from: z.string(),
      to: z.string(),
      at: z.iso.datetime({ offset: true }),
      /** Estava confirmado como reservado: a reserva no roteador não pegou. */
      wasReserved: z.boolean(),
    })
    .nullable(),
});
export type Network = z.infer<typeof networkSchema>;

export const publishAddressSchema = z.object({
  address: ipv4Schema,
  /** Omitido: mantém a confirmação se o IP for o mesmo, zera se mudar. */
  reserved: z.boolean().optional(),
});
export type PublishAddressInput = z.infer<typeof publishAddressSchema>;
