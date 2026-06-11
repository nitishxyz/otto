UPDATE `goal_tasks` SET `status` = 'in_progress', `updated_at` = (strftime('%s','now') * 1000) WHERE `status` = 'done_pending';
