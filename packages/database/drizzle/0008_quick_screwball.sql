CREATE INDEX `message_parts_message_index_idx` ON `message_parts` (`message_id`,`index`);--> statement-breakpoint
CREATE INDEX `messages_session_created_idx` ON `messages` (`session_id`,`created_at`);