CREATE TYPE "public"."payment_method" AS ENUM('cash', 'credit', 'debit', 'pix');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('active', 'canceled');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "payments_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tab_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	"received_cents" integer,
	"change_cents" integer DEFAULT 0 NOT NULL,
	"status" "payment_status" DEFAULT 'active' NOT NULL,
	"cancel_reason" text,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_change_nonnegative" CHECK ("payments"."change_cents" >= 0),
	CONSTRAINT "payments_cancel_reason" CHECK ("payments"."status" <> 'canceled' or "payments"."cancel_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "tabs" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "tabs" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tab_id_tabs_id_fk" FOREIGN KEY ("tab_id") REFERENCES "public"."tabs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_tab_idx" ON "payments" USING btree ("tab_id");--> statement-breakpoint
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_cancel_reason" CHECK ("tabs"."status" <> 'canceled' or "tabs"."cancel_reason" is not null);