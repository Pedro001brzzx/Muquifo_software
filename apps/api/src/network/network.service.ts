import {
  errorCodes,
  type Network,
  type PublishAddressInput,
} from '@muquifo/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AppException } from '../common/app-exception.js';
import { lanInterfaces } from '../common/lan.js';
import type { Database } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { restaurant } from '../db/schema.js';
import { hostDetails, routerBrand } from './host-network.js';

type Details = Pick<
  NonNullable<Network['primary']>,
  'gateway' | 'dhcp' | 'router'
>;

/** Roteador e DHCP mudam raramente; consultar o Windows custa ~1 s. */
const DETAILS_TTL_MS = 5 * 60_000;
/** De quanto em quanto tempo o servidor confere se o IP mudou. */
const WATCH_INTERVAL_MS = 30_000;

@Injectable()
export class NetworkService implements OnApplicationShutdown {
  private readonly logger = new Logger('Rede');
  private readonly cache = new Map<
    string,
    { at: number; value: Promise<Details> }
  >();
  private timer: NodeJS.Timeout | undefined;

  constructor(@Inject(DB) private readonly db: Database) {}

  async get(): Promise<Network> {
    await this.follow();
    const interfaces = lanInterfaces();
    const [first] = interfaces;
    const settings = await this.settings();
    const addresses = interfaces.map((i) => i.address);
    return {
      addresses,
      primary: first
        ? {
            address: first.address,
            interfaceName: first.name,
            mac: first.mac,
            ...(await this.details(first.address)),
          }
        : null,
      publishedAddress: settings.publishedAddress,
      addressChanged:
        settings.publishedAddress !== null &&
        !addresses.includes(settings.publishedAddress),
      addressReserved: settings.addressReserved,
      pendingChange:
        !settings.addressChangeSeen &&
        settings.previousAddress &&
        settings.publishedAddress &&
        settings.addressChangedAt
          ? {
              from: settings.previousAddress,
              to: settings.publishedAddress,
              at: settings.addressChangedAt.toISOString(),
              wasReserved: settings.previousReserved,
            }
          : null,
    };
  }

  /** Grava o IP que vai nos QR codes e nos celulares. */
  async publish(input: PublishAddressInput): Promise<Network> {
    const addresses = lanInterfaces().map((i) => i.address);
    if (!addresses.includes(input.address)) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCodes.validation,
        'Esse endereço não é desta máquina.',
        { field: 'address', addresses },
      );
    }
    const current = await this.settings();
    const same = current.publishedAddress === input.address;
    await this.db
      .update(restaurant)
      .set({
        publishedAddress: input.address,
        addressReserved:
          input.reserved ?? (same ? current.addressReserved : false),
      })
      .where(eq(restaurant.id, 1));
    return this.get();
  }

  /** O dono viu o aviso da troca de IP (já reimprimiu ou vai reimprimir). */
  async acknowledgeChange(): Promise<Network> {
    await this.db
      .update(restaurant)
      .set({ addressChangeSeen: true })
      .where(eq(restaurant.id, 1));
    return this.get();
  }

  /**
   * Segue o IP novo quando o roteador troca o desta máquina (sem reserva, ou
   * com reserva que não pegou): o sistema continua acessível pelo endereço
   * atual, os QR codes da tela já saem certos e o dono é avisado para
   * reimprimir os antigos. Na primeira vez, só grava o IP de agora.
   */
  async follow(): Promise<void> {
    const [first] = lanInterfaces();
    // Sem rede, ou só VPN/WSL: o celular não alcança nenhum; espera voltar.
    if (!first || first.unreachable) return;
    const current = await this.settings();
    if (current.publishedAddress === first.address) return;

    const addresses = lanInterfaces().map((i) => i.address);
    if (current.publishedAddress === null) {
      await this.db
        .update(restaurant)
        .set({ publishedAddress: first.address })
        .where(eq(restaurant.id, 1));
      return;
    }
    // O publicado ainda é desta máquina (ex.: escolhido à mão no QR): mantém.
    if (addresses.includes(current.publishedAddress)) return;

    await this.db
      .update(restaurant)
      .set({
        previousAddress: current.publishedAddress,
        previousReserved: current.addressReserved,
        publishedAddress: first.address,
        addressReserved: false,
        addressChangedAt: new Date(),
        addressChangeSeen: false,
      })
      .where(eq(restaurant.id, 1));
    this.logger.warn(
      `O IP desta máquina mudou de ${current.publishedAddress} para ${first.address}. ` +
        'O sistema já passou a usar o novo; reimprima os QR codes e escaneie de novo nos celulares.',
    );
  }

  /** Confere o IP periodicamente enquanto o servidor estiver no ar. */
  watch(): void {
    if (this.timer) return;
    void this.follow().catch(() => undefined);
    void this.details(lanInterfaces()[0]?.address ?? '');
    this.timer = setInterval(() => {
      this.follow().catch((error: unknown) =>
        this.logger.error('Falha ao conferir o IP', error),
      );
    }, WATCH_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private details(address: string): Promise<Details> {
    const hit = this.cache.get(address);
    if (hit && Date.now() - hit.at < DETAILS_TTL_MS) return hit.value;
    const value = hostDetails(address).then(async (host) => ({
      ...host,
      router: host.gateway ? await routerBrand(host.gateway) : null,
    }));
    this.cache.set(address, { at: Date.now(), value });
    return value;
  }

  private async settings() {
    await this.db.insert(restaurant).values({ id: 1 }).onConflictDoNothing();
    const [row] = await this.db
      .select({
        publishedAddress: restaurant.publishedAddress,
        addressReserved: restaurant.addressReserved,
        previousAddress: restaurant.previousAddress,
        previousReserved: restaurant.previousReserved,
        addressChangedAt: restaurant.addressChangedAt,
        addressChangeSeen: restaurant.addressChangeSeen,
      })
      .from(restaurant)
      .where(eq(restaurant.id, 1));
    return row;
  }
}
