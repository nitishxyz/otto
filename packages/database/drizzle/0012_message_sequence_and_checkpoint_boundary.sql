DROP INDEX `message_parts_message_index_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `message_parts_message_index_unique` ON `message_parts` (`message_id`,`index`);--> statement-breakpoint
ALTER TABLE `messages` ADD `sequence` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_session_sequence_idx` ON `messages` (`session_id`,`sequence`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `compaction_through_message_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `inherited_context` text;