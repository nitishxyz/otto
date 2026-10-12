ALTER TABLE `subagents` ADD `attempt_id` text;--> statement-breakpoint
ALTER TABLE `subagents` ADD `attempt_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subagents` ADD `delivery_state` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `subagents` ADD `delivery_key` text;--> statement-breakpoint
ALTER TABLE `subagents` ADD `finished_message_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `subagents_running_child_unique` ON `subagents` (`child_session_id`) WHERE status = 'running';