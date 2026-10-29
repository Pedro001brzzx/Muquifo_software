import type { PublicMenu } from '@muquifo/contracts';
import { Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { OptionGroupsService } from '../options/option-groups.service.js';
import { PizzaService } from '../pizza/pizza.service.js';
import { RestaurantService } from '../restaurant/restaurant.service.js';

@Injectable()
export class MenuService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly optionGroups: OptionGroupsService,
    private readonly pizza: PizzaService,
    private readonly restaurant: RestaurantService,
  ) {}

  /** Monta o cardápio público na ordem das categorias, sem campos internos. */
  async publicMenu(): Promise<PublicMenu> {
    const [info, categories, products, groups, tiers, flavors] =
      await Promise.all([
        this.restaurant.get(),
        this.catalog.listCategories(),
        this.catalog.listProducts({ status: 'active' }),
        this.optionGroups.list({ status: 'active' }),
        this.pizza.listTiers({ status: 'active' }),
        this.pizza.listFlavors({ status: 'active' }),
      ]);
    const groupById = new Map(groups.map((g) => [g.id, g]));

    return {
      restaurant: {
        name: info.name,
        tagline: info.tagline,
        notice: info.notice,
      },
      categories: categories
        .filter((c) => c.active)
        .map((c) => ({
          id: c.id,
          name: c.name,
          items: products
            .filter((p) => p.categoryId === c.id)
            .map((p) => {
              // Mesma regra do pedido: categoria (menos os desligados) e depois o produto.
              const ids = [
                ...new Set([
                  ...c.optionGroupIds.filter(
                    (id) => !p.excludedOptionGroupIds.includes(id),
                  ),
                  ...p.optionGroupIds,
                ]),
              ];
              return {
                id: p.id,
                name: p.name,
                description: p.description,
                priceCents: p.priceCents,
                icon: p.icon,
                available: p.available,
                allowFractional: p.allowFractional,
                maxFlavors: p.maxFlavors,
                ingredients: p.ingredients.map((i) => i.name),
                extras: ids
                  .map((id) => groupById.get(id))
                  .filter((g) => g !== undefined)
                  .map((g) => ({
                    name: g.name,
                    required: g.minSelect > 0,
                    options: g.options
                      .filter((o) => o.available)
                      .map((o) => ({ name: o.name, priceCents: o.priceCents })),
                  })),
              };
            }),
        }))
        .filter((c) => c.items.length > 0),
      pizzaTiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        prices: t.prices,
        flavors: flavors
          .filter((f) => f.tierId === t.id)
          .map((f) => ({
            name: f.name,
            description: f.description,
            available: f.available,
          })),
      })),
    };
  }
}
