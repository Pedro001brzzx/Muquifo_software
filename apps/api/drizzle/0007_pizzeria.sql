CREATE TABLE "order_item_flavors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"flavor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tier_name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pizza_flavors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"available" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pizza_tier_prices" (
	"tier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	CONSTRAINT "pizza_tier_prices_tier_id_product_id_pk" PRIMARY KEY("tier_id","product_id"),
	CONSTRAINT "pizza_tier_prices_nonnegative" CHECK ("pizza_tier_prices"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pizza_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "max_flavors" integer;--> statement-breakpoint
ALTER TABLE "order_item_flavors" ADD CONSTRAINT "order_item_flavors_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_flavors" ADD CONSTRAINT "order_item_flavors_flavor_id_pizza_flavors_id_fk" FOREIGN KEY ("flavor_id") REFERENCES "public"."pizza_flavors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pizza_flavors" ADD CONSTRAINT "pizza_flavors_tier_id_pizza_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."pizza_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pizza_tier_prices" ADD CONSTRAINT "pizza_tier_prices_tier_id_pizza_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."pizza_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pizza_tier_prices" ADD CONSTRAINT "pizza_tier_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_item_flavors_item_idx" ON "order_item_flavors" USING btree ("order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pizza_flavors_name_uq" ON "pizza_flavors" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "pizza_flavors_tier_idx" ON "pizza_flavors" USING btree ("tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pizza_tiers_name_uq" ON "pizza_tiers" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_max_flavors_range" CHECK ("products"."max_flavors" is null or "products"."max_flavors" between 1 and 4);