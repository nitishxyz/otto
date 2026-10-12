-- Custom SQL migration file, put your code below! --
-- Renumber parts of messages that contain duplicate (message_id, index) pairs so
-- the unique index added by the next migration can be created. Order is kept
-- by (index, started_at, rowid); unaffected messages keep their indexes.
CREATE TEMP TABLE otto_part_renumber AS
SELECT
	id,
	ROW_NUMBER() OVER (
		PARTITION BY message_id
		ORDER BY "index", COALESCE(started_at, 0), rowid
	) - 1 AS new_index
FROM message_parts
WHERE message_id IN (
	SELECT message_id FROM message_parts
	GROUP BY message_id, "index"
	HAVING COUNT(*) > 1
);
--> statement-breakpoint
UPDATE message_parts
SET "index" = (
	SELECT new_index FROM otto_part_renumber WHERE otto_part_renumber.id = message_parts.id
)
WHERE id IN (SELECT id FROM otto_part_renumber);
--> statement-breakpoint
DROP TABLE otto_part_renumber;
