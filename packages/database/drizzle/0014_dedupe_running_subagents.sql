-- Custom SQL migration file, put your code below! --
-- At most one running attempt may exist per child session (enforced by the
-- partial unique index added in the next migration). Keep the newest running
-- record per child session by (created_at, updated_at, rowid); cancel the
-- older duplicates and leave them unreported so the parent is told about it.
CREATE TEMP TABLE otto_stale_running_subagents AS
SELECT id FROM (
	SELECT
		id,
		ROW_NUMBER() OVER (
			PARTITION BY child_session_id
			ORDER BY created_at DESC, updated_at DESC, rowid DESC
		) AS rank
	FROM subagents
	WHERE status = 'running'
)
WHERE rank > 1;
--> statement-breakpoint
UPDATE subagents
SET
	status = 'cancelled',
	summary = COALESCE(summary || char(10) || char(10), '') ||
		'Cancelled during upgrade: superseded by a newer running task in the same sub-agent session.',
	reported = 0,
	updated_at = updated_at + 1
WHERE id IN (SELECT id FROM otto_stale_running_subagents);
--> statement-breakpoint
DROP TABLE otto_stale_running_subagents;
