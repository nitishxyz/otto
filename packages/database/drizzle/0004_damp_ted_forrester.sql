CREATE TABLE `goal_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`position` integer NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_path` text NOT NULL,
	`session_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subagents` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_session_id` text NOT NULL,
	`child_session_id` text NOT NULL,
	`agent` text NOT NULL,
	`task` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`summary` text,
	`reported` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
