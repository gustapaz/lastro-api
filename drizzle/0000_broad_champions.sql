CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sandbox_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`type` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`sandbox_id`) REFERENCES `sandboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_list` ON `events` (`sandbox_id`,`id`);--> statement-breakpoint
CREATE TABLE `products` (
	`sandbox_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`stock` integer NOT NULL,
	PRIMARY KEY(`sandbox_id`, `sku`),
	FOREIGN KEY (`sandbox_id`) REFERENCES `sandboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "stock_nonnegative" CHECK("products"."stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE `quotas` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quotas_expiry` ON `quotas` (`expires_at`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`sandbox_id` text NOT NULL,
	`sku` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`sandbox_id`) REFERENCES `sandboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sandbox_id`,`sku`) REFERENCES `products`(`sandbox_id`,`sku`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quantity_positive" CHECK("reservations"."quantity" between 1 and 100),
	CONSTRAINT "status_valid" CHECK("reservations"."status" in ('held','confirmed','released'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_key` ON `reservations` (`sandbox_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `reservations_stock` ON `reservations` (`sandbox_id`,`sku`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `reservations_list` ON `reservations` (`sandbox_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `sandboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandboxes_token` ON `sandboxes` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sandboxes_expiry` ON `sandboxes` (`expires_at`);
--> statement-breakpoint
CREATE TRIGGER reservation_created AFTER INSERT ON reservations BEGIN
 INSERT INTO events(sandbox_id,reservation_id,type,at) VALUES(NEW.sandbox_id,NEW.id,'created',NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER reservation_changed AFTER UPDATE OF status ON reservations WHEN OLD.status <> NEW.status BEGIN
 INSERT INTO events(sandbox_id,reservation_id,type,at) VALUES(NEW.sandbox_id,NEW.id,CASE NEW.status WHEN 'confirmed' THEN 'confirmed' ELSE 'released' END,unixepoch());
END;
