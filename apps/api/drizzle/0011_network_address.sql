ALTER TABLE "restaurant" ADD COLUMN "published_address" text;--> statement-breakpoint
ALTER TABLE "restaurant" ADD COLUMN "address_reserved" boolean DEFAULT false NOT NULL;