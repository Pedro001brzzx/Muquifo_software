import type { Network } from '@muquifo/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';

/** Rede do servidor; revisada a cada minuto para o alarme de IP mudado. */
export function useNetwork() {
  return useQuery({
    queryKey: queryKeys.network,
    queryFn: api.network,
    refetchInterval: 60_000,
  });
}

/** IP que os celulares devem usar: o publicado, se ainda é desta máquina. */
export function serverAddress(net: Network | undefined): string | null {
  if (!net) return null;
  if (net.publishedAddress && !net.addressChanged) return net.publishedAddress;
  return net.addresses[0] ?? null;
}

/** Link do sistema na rede, na mesma porta em que este app foi aberto. */
export function serverUrl(address: string, path = '/') {
  return `${location.protocol}//${address}${location.port ? `:${location.port}` : ''}${path}`;
}

/** O IP não muda sozinho: reservado no roteador ou fixo no Windows. */
export const isAddressFixed = (net: Network) =>
  !net.addressChanged && (net.addressReserved || net.primary?.dhcp === false);

/** MAC no formato que os roteadores mostram: 74-56-3C-75-91-66. */
export const formatMac = (mac: string) =>
  mac.toUpperCase().replaceAll(':', '-');
