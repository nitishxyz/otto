-- Custom SQL migration file, put your code below! --
-- Backfill per-session message sequence in (created_at, rowid) order, then
-- assign it automatically for every future insert that omits it.
CREATE TEMP TABLE otto_message_sequence AS
SELECT
	id,
	ROW_NUMBER() OVER (
		PARTITION BY session_id
		ORDER BY created_at, rowid
	) AS seq
FROM messages
WHERE sequence IS NULL;
--> statement-breakpoint
UPDATE messages
SET sequence = (
	SELECT seq FROM otto_message_sequence WHERE otto_message_sequence.id = messages.id
)
WHERE id IN (SELECT id FROM otto_message_sequence);
--> statement-breakpoint
DROP TABLE otto_message_sequence;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS messages_assign_sequence
AFTER INSERT ON messages
FOR EACH ROW WHEN NEW.sequence IS NULL
BEGIN
	UPDATE messages
	SET sequence = (
		SELECT COALESCE(MAX(sequence), 0) + 1 FROM messages WHERE session_id = NEW.session_id
	)
	WHERE id = NEW.id;
END;
