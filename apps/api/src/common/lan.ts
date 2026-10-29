import { networkInterfaces } from 'node:os';

/** Placas que o celular no Wi-Fi do restaurante não alcança. */
const VIRTUAL =
  /vethernet|wsl|docker|virtualbox|vmware|hyper-v|vbox|bluetooth|vpn|radmin|hamachi|zerotier|tailscale/i;

export interface LanInterface {
  name: string;
  address: string;
  mac: string | null;
  /** VPN, WSL ou auto-configurado: o celular no Wi-Fi não chega nela. */
  unreachable: boolean;
}

/**
 * Placas IPv4 desta máquina, da mais provável para o celular alcançar à
 * menos: placa física na faixa de rede doméstica primeiro; virtuais (WSL,
 * Docker, VPN) e auto-configurados (169.254) por último.
 */
export function lanInterfaces(): LanInterface[] {
  const found = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? [])
      .filter((a) => a.family === 'IPv4' && !a.internal)
      .map((a) => ({
        name,
        address: a.address,
        mac: a.mac && a.mac !== '00:00:00:00:00:00' ? a.mac : null,
        unreachable: VIRTUAL.test(name) || a.address.startsWith('169.254.'),
      })),
  );
  const rank = ({ name, address }: LanInterface) =>
    (VIRTUAL.test(name) ? 10 : 0) +
    (address.startsWith('192.168.')
      ? 0
      : address.startsWith('10.')
        ? 1
        : address.startsWith('169.254.')
          ? 5
          : 2);
  const seen = new Set<string>();
  return found
    .sort((a, b) => rank(a) - rank(b))
    .filter((i) => !seen.has(i.address) && seen.add(i.address));
}

export function lanAddresses(): string[] {
  return lanInterfaces().map((i) => i.address);
}
