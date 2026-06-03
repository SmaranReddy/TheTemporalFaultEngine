CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payload" text NOT NULL,
	"scheduled_at" timestamp (3) with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"claimed_by" text,
	"lease_expires_at" timestamp (3) with time zone,
	"executed_at" timestamp (3) with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_events_scheduled_at" ON "events" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_events_status" ON "events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_events_lease_expires_at" ON "events" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "idx_events_claimed_by" ON "events" USING btree ("claimed_by");