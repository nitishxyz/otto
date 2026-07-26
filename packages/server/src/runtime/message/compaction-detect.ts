export function isCompactCommand(content: string): boolean {
	const trimmed = content.trim().toLowerCase();
	return trimmed === '/compact';
}

export function getCompactionSystemPrompt(): string {
	return `
Create a canonical session checkpoint that will REPLACE all conversation history provided below.
Preserve execution state, not the transcript. The next run receives only this checkpoint and messages
created after it, so include what a new agent needs to continue the work immediately.

Use this exact structure, omitting empty sections:

# Session Checkpoint

## Charter
The session's durable overall goal, user priorities, and hard constraints. Preserve the original intent
even when the active task is narrower.

## Active task
Summarize the latest user instruction and what the agent was doing immediately before compaction.
Never reproduce the complete latest turn. Quote only exact constraints, identifiers, or literal values
whose wording matters.

## Current state
What is complete, what is partially complete, and what has not started.

## Decisions and constraints
Only choices and constraints that still affect future work.

## Durable changes
Changed files, persisted artifacts, configuration, or external mutations. Prefer references to durable
state over copied content.

## Verification
Checks already run and their meaningful outcomes.

## Continuation evidence
At most 3 tiny, selected outcomes that are essential for the next action: an unresolved failure, an
interrupted operation, an active terminal/sub-agent/approval, or an irreversible external action.
Do not reproduce raw tool calls or logs. Omit successful reads, searches, edits, and routine commands.

## Blockers
Only unresolved errors or unknowns.

## Next action
The exact first action the next agent should take.

Rules:
- Do not narrate or quote the conversation.
- Merge any PREVIOUS CHECKPOINT into one updated checkpoint; never retain checkpoint history.
- Summarize the latest turn instead of preserving it verbatim.
- Drop completed exploration, old errors, reasoning, and tool output unless they affect the next action.
- Keep the whole checkpoint under 6000 characters. Be concise; 1500-3000 characters is preferred.
`;
}
