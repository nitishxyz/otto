-- Custom SQL migration file, put your code below! --
-- Derive the outbox state of existing records from the legacy reported flag.
UPDATE subagents
SET delivery_state = CASE
	WHEN status = 'running' THEN 'none'
	WHEN reported = 1 THEN 'delivered'
	ELSE 'pending'
END;
