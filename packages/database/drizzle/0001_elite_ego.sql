ALTER TABLE `sessions` ADD `last_viewed_at` integer;
UPDATE `sessions` SET `last_viewed_at` = COALESCE(`last_active_at`, `created_at`);
