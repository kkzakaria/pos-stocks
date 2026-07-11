CREATE TABLE `purchase_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cost` integer NOT NULL,
	`lot_number` text,
	`expiry_date` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `purchase_items_purchase_idx` ON `purchase_items` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`reference` text,
	`created_by` text NOT NULL,
	`received_by` text,
	`received_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `purchases_org_status_idx` ON `purchases` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `stock_levels` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`avg_cost` integer DEFAULT 0 NOT NULL,
	`min_stock` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "stock_levels_quantity_positive" CHECK("stock_levels"."quantity" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_levels_wh_variant_uidx` ON `stock_levels` (`warehouse_id`,`variant_id`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`lot_id` text,
	`delta` integer NOT NULL,
	`type` text NOT NULL,
	`reason` text,
	`ref_type` text,
	`ref_id` text,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_movements_org_wh_date_idx` ON `stock_movements` (`organization_id`,`warehouse_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_variant_idx` ON `stock_movements` (`variant_id`);