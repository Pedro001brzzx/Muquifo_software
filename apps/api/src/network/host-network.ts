import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Só endereços de rede local: o servidor nunca sai para a internet aqui. */
const isPrivate = (ip: string) =>
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) && IPV4.test(ip);

export interface HostDetails {
  gateway: string | null;
  dhcp: boolean | null;
}

/**
 * Roteador e modo do IP (DHCP ou fixo) da placa com esse endereço, pelo
 * PowerShell do Windows. Fora do Windows, ou se falhar, volta desconhecido.
 */
export async function hostDetails(address: string): Promise<HostDetails> {
  const unknown = { gateway: null, dhcp: null };
  if (process.platform !== 'win32' || !IPV4.test(address)) return unknown;
  const script = `
$c = Get-NetIPConfiguration | Where-Object { $_.IPv4Address.IPAddress -eq '${address}' } | Select-Object -First 1
if ($c) {
  [pscustomobject]@{
    gateway = "$($c.IPv4DefaultGateway.NextHop)"
    dhcp = "$((Get-NetIPInterface -InterfaceIndex $c.InterfaceIndex -AddressFamily IPv4).Dhcp)"
  } | ConvertTo-Json -Compress
}`;
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10_000, windowsHide: true },
    );
    const parsed = JSON.parse(stdout.trim() || 'null') as {
      gateway?: string;
      dhcp?: string;
    } | null;
    if (!parsed) return unknown;
    return {
      gateway:
        parsed.gateway && IPV4.test(parsed.gateway) ? parsed.gateway : null,
      dhcp:
        parsed.dhcp === 'Enabled'
          ? true
          : parsed.dhcp === 'Disabled'
            ? false
            : null,
    };
  } catch {
    return unknown;
  }
}

/** Ordem importa: Mercusys é da TP-Link e a página dela cita as duas. */
const BRANDS: [RegExp, string][] = [
  [/mercusys/i, 'Mercusys'],
  [/tp-?link/i, 'TP-Link'],
  [/intelbras/i, 'Intelbras'],
  [/d-?link/i, 'D-Link'],
  [/multilaser/i, 'Multilaser'],
  [/tenda/i, 'Tenda'],
  [/huawei/i, 'Huawei'],
  [/\bzte\b/i, 'ZTE'],
  [/nokia/i, 'Nokia'],
  [/fiberhome/i, 'Fiberhome'],
  [/sagemcom/i, 'Sagemcom'],
  [/askey/i, 'Askey'],
  [/mitrastar/i, 'MitraStar'],
  [/arcadyan/i, 'Arcadyan'],
  [/\basus\b/i, 'ASUS'],
  [/xiaomi|miwifi/i, 'Xiaomi'],
  [/linksys/i, 'Linksys'],
  [/netgear/i, 'Netgear'],
  [/elsys/i, 'Elsys'],
];

/**
 * Marca do roteador pela página inicial dele (sem login), para o guia
 * mostrar o caminho certo do menu. Melhor esforço: nulo se não reconhecer.
 */
export async function routerBrand(gateway: string): Promise<string | null> {
  if (!isPrivate(gateway)) return null;
  try {
    const res = await fetch(`http://${gateway}/`, {
      signal: AbortSignal.timeout(3000),
    });
    const text = [
      res.headers.get('server') ?? '',
      res.headers.get('www-authenticate') ?? '',
      (await res.text()).slice(0, 300_000),
    ].join('\n');
    return BRANDS.find(([re]) => re.test(text))?.[1] ?? null;
  } catch {
    return null;
  }
}
