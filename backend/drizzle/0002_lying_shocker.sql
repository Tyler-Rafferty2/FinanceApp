CREATE TABLE "plaid_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plaid_item_id" text NOT NULL,
	"institution_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plaid_items_plaid_item_id_unique" UNIQUE("plaid_item_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "plaid_item_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "plaid_account_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "plaid_transaction_id" text;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plaid_account_id_unique" UNIQUE("plaid_account_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_plaid_transaction_id_unique" UNIQUE("plaid_transaction_id");