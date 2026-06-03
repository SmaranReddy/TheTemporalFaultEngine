CREATE TABLE "event_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"worker_id" text NOT NULL,
	"idempotency_key" text,
	"execution_status" varchar(16) DEFAULT 'STARTED' NOT NULL,
	"execution_started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"execution_completed_at" timestamp (3) with time zone,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "last_execution_attempt_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "event_executions" ADD CONSTRAINT "event_executions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_exec_completed_idempotency_key" ON "event_executions" USING btree ("idempotency_key") WHERE execution_status = 'COMPLETED' AND idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_exec_event_id" ON "event_executions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_exec_status" ON "event_executions" USING btree ("execution_status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_events_idempotency_key" ON "events" USING btree ("idempotency_key") WHERE idempotency_key IS NOT NULL;