CREATE TYPE "public"."cash_movement_kind" AS ENUM('withdrawal', 'reinforcement');--> statement-breakpoint
CREATE TYPE "public"."cash_session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" "cash_movement_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"operator" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movements_amount_positive" CHECK ("cash_movements"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "cash_sessions_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"status" "cash_session_status" DEFAULT 'open' NOT NULL,
	"opened_by" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opening_float_cents" integer NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"expected_cash_cents" integer,
	"expected_credit_cents" integer,
	"expected_debit_cents" integer,
	"expected_pix_cents" integer,
	"counted_cash_cents" integer,
	"counted_credit_cents" integer,
	"counted_debit_cents" integer,
	"counted_pix_cents" integer,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_sessions_float_nonnegative" CHECK ("cash_sessions"."opening_float_cents" >= 0),
	CONSTRAINT "cash_sessions_closed_complete" CHECK ("cash_sessions"."status" = 'open' or ("cash_sessions"."closed_at" is not null and "cash_sessions"."counted_cash_cents" is not null and "cash_sessions"."expected_cash_cents" is not null))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cash_session_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_session_id_cash_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_movements_session_idx" ON "cash_movements" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_number_uq" ON "cash_sessions" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_one_open_uq" ON "cash_sessions" USING btree ("status") WHERE "cash_sessions"."status" = 'open';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_cash_session_idx" ON "payments" USING btree ("cash_session_id");