ALTER TABLE "restaurant" ADD COLUMN "previous_address" text;--> statement-breakpoint
ALTER TABLE "restaurant" ADD COLUMN "previous_reserved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant" ADD COLUMN "address_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restaurant" ADD COLUMN "address_change_seen" boolean DEFAULT true NOT NULL;