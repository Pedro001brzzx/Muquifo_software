import {
  type createOptionGroupSchema,
  errorCodes,
  type listOptionGroupsQuerySchema,
  type Option,
  type OptionGroup,
  type updateOptionGroupSchema,
} from '@muquifo/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, notInArray, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../common/app-exception.js';
import type { Database, Executor, Transaction } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { optionGroups, options } from '../db/schema.js';

type OptionRow = typeof options.$inferSelect;

const toOption = (o: OptionRow): Option => ({
  id: o.id,
  groupId: o.groupId,
  name: o.name,
  priceCents: o.priceCents,
  available: o.available,
  sortOrder: o.sortOrder,
  childGroupId: o.childGroupId,
});

/** Grupos com as opções ativas e onde estão ligados. */
export async function loadOptionGroups(
  db: Executor,
  where?: SQL,
): Promise<OptionGroup[]> {
  const groups = await db
    .select({
      group: optionGroups,
      // Nomes explícitos: em select de uma tabela só o Drizzle omite o nome da tabela.
      productCount: sql<number>`(select count(*) from product_option_groups pog where pog.group_id = option_groups.id)::int`,
      categoryCount: sql<number>`(select count(*) from category_option_groups cog where cog.group_id = option_groups.id)::int`,
    })
    .from(optionGroups)
    .where(where)
    .orderBy(asc(optionGroups.name));
  if (groups.length === 0) return [];
  const rows = await db
    .select()
    .from(options)
    .where(
      and(
        inArray(
          options.groupId,
          groups.map((g) => g.group.id),
        ),
        eq(options.active, true),
      ),
    )
    .orderBy(asc(options.sortOrder), asc(options.name));
  return groups.map(({ group, productCount, categoryCount }) => ({
    id: group.id,
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    active: group.active,
    version: group.version,
    options: rows.filter((o) => o.groupId === group.id).map(toOption),
    productCount,
    categoryCount,
  }));
}

async function getGroup(db: Executor, id: string): Promise<OptionGroup> {
  const [group] = await loadOptionGroups(db, eq(optionGroups.id, id));
  if (!group) throw AppException.notFound('Grupo de complementos', id);
  return group;
}

@Injectable()
export class OptionGroupsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  list(
    query: z.output<typeof listOptionGroupsQuerySchema>,
  ): Promise<OptionGroup[]> {
    return loadOptionGroups(
      this.db,
      query.status === 'all'
        ? undefined
        : eq(optionGroups.active, query.status === 'active'),
    );
  }

  create(
    input: z.output<typeof createOptionGroupSchema>,
  ): Promise<OptionGroup> {
    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .insert(optionGroups)
        .values({
          name: input.name,
          minSelect: input.minSelect,
          maxSelect: input.maxSelect,
        })
        .returning({ id: optionGroups.id });
      await assertChildGroups(tx, group.id, input.options);
      await tx.insert(options).values(
        input.options.map((o, i) => ({
          groupId: group.id,
          name: o.name,
          priceCents: o.priceCents,
          available: o.available,
          childGroupId: o.childGroupId,
          sortOrder: i,
        })),
      );
      return getGroup(tx, group.id);
    });
  }

  /**
   * Edição com concorrência otimista. `options` é a lista completa: as que
   * ficarem de fora são arquivadas, porque podem estar em pedidos antigos.
   */
  update(
    id: string,
    {
      version,
      options: list,
      ...fields
    }: z.output<typeof updateOptionGroupSchema>,
  ): Promise<OptionGroup> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(optionGroups)
        .where(eq(optionGroups.id, id))
        .for('update');
      if (!current) throw AppException.notFound('Grupo de complementos', id);
      if (current.version !== version) {
        throw AppException.versionConflict(
          'Grupo de complementos',
          current.version,
        );
      }
      const minSelect = fields.minSelect ?? current.minSelect;
      const maxSelect = fields.maxSelect ?? current.maxSelect;
      if (maxSelect < minSelect) {
        throw new AppException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          errorCodes.validation,
          'O máximo não pode ser menor que o mínimo.',
          [
            {
              path: 'maxSelect',
              message: 'O máximo não pode ser menor que o mínimo.',
            },
          ],
        );
      }
      if (list) await replaceOptions(tx, id, list);

      const activeCount = await tx.$count(
        options,
        and(eq(options.groupId, id), eq(options.active, true)),
      );
      if (activeCount < minSelect) {
        throw new AppException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          errorCodes.validation,
          'Há menos opções do que o mínimo exigido.',
          [
            {
              path: 'options',
              message: 'Há menos opções do que o mínimo exigido.',
            },
          ],
        );
      }
      await tx
        .update(optionGroups)
        .set({ ...fields, version: sql`${optionGroups.version} + 1` })
        .where(eq(optionGroups.id, id));
      return getGroup(tx, id);
    });
  }
}

async function replaceOptions(
  tx: Transaction,
  groupId: string,
  list: NonNullable<z.output<typeof updateOptionGroupSchema>['options']>,
) {
  const existing = await tx
    .select({ id: options.id })
    .from(options)
    .where(eq(options.groupId, groupId));
  const owned = new Set(existing.map((o) => o.id));
  const foreign = list.filter((o) => o.id && !owned.has(o.id));
  if (foreign.length > 0) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      errorCodes.validation,
      'Opção de outro grupo.',
      { optionIds: foreign.map((o) => o.id) },
    );
  }
  await assertChildGroups(tx, groupId, list);
  const kept: string[] = [];
  for (const [i, o] of list.entries()) {
    if (o.id) {
      kept.push(o.id);
      await tx
        .update(options)
        .set({
          name: o.name,
          priceCents: o.priceCents,
          available: o.available,
          childGroupId: o.childGroupId,
          active: true,
          sortOrder: i,
        })
        .where(eq(options.id, o.id));
    } else {
      const [created] = await tx
        .insert(options)
        .values({
          groupId,
          name: o.name,
          priceCents: o.priceCents,
          available: o.available,
          childGroupId: o.childGroupId,
          sortOrder: i,
        })
        .returning({ id: options.id });
      kept.push(created.id);
    }
  }
  // As que ficaram fora da lista são arquivadas.
  await tx
    .update(options)
    .set({ active: false })
    .where(
      and(
        eq(options.groupId, groupId),
        eq(options.active, true),
        notInArray(options.id, kept),
      ),
    );
}

/** Grupo filho (Combo → Bebida do combo) precisa existir, estar ativo e não ser o próprio grupo. */
async function assertChildGroups(
  tx: Transaction,
  groupId: string,
  list: { name: string; childGroupId: string | null }[],
) {
  const childIds = [
    ...new Set(list.map((o) => o.childGroupId).filter((id) => id !== null)),
  ];
  if (childIds.length === 0) return;
  const fail = (message: string) => {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      errorCodes.validation,
      message,
      [{ path: 'options', message }],
    );
  };
  if (childIds.includes(groupId)) {
    fail('Uma opção não pode abrir o próprio grupo.');
  }
  const found = await tx
    .select({ id: optionGroups.id, active: optionGroups.active })
    .from(optionGroups)
    .where(inArray(optionGroups.id, childIds));
  if (found.length !== childIds.length || found.some((g) => !g.active)) {
    fail('O grupo aberto pela opção não existe ou está arquivado.');
  }
}
