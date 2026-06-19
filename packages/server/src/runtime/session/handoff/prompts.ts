import type { SessionRow } from './types.ts';

const HANDOFF_MAX_CONTEXT_CHARS = 24_000;

export function isHandoffCommand(content: string): boolean {
	return content.trim().toLowerCase() === '/handoff';
}

export function buildHandoffContext(args: {
	sourceSession: SessionRow;
	context: string;
	createdAt?: Date;
}): string {
	const { sourceSession, context, createdAt = new Date() } = args;
	return [
		'# Session Handoff',
		'',
		'You are continuing work from a previous otto session. Treat this as inherited context, not as a new user request.',
		'',
		`Source session: ${sourceSession.id}`,
		`Created: ${createdAt.toISOString()}`,
		`Project: ${sourceSession.projectPath}`,
		`Inherited agent/model: ${sourceSession.agent} / ${sourceSession.provider}:${sourceSession.model}`,
		'',
		'Continue from the current state. Do not redo completed work unless the user asks or verification requires it.',
		'',
		'## Carried context',
		'',
		context.trim() || 'No prior message context was available.',
	].join('\n');
}

export function getHandoffSystemPrompt(): string {
	return [
		'You are preparing a concise handoff for a new coding-agent session.',
		'',
		'Your job is to summarize only the information needed to continue the work in a fresh session.',
		'Do not copy raw logs or long tool outputs unless a specific detail is critical.',
		'',
		'Include these sections:',
		'1. Current goal',
		'2. Current state',
		'3. Important decisions and constraints',
		'4. Files or areas touched',
		'5. Commands/checks run and their outcome',
		'6. Open tasks, blockers, and next best action',
		'',
		'Rules:',
		'- Be specific and practical for a coding agent.',
		'- Preserve exact file paths, commands, IDs, and user constraints when relevant.',
		'- Say when verification was not run or the state is uncertain.',
		'- Keep the final handoff under roughly 4000 tokens.',
		'- Output markdown only. Start with "# Handoff".',
	].join('\n');
}

export function buildHandoffUserPrompt(args: {
	sourceSession: SessionRow;
	rawContext: string;
}): string {
	const { sourceSession, rawContext } = args;
	return [
		'Prepare a handoff summary for this otto session.',
		'',
		`Source session: ${sourceSession.id}`,
		`Project: ${sourceSession.projectPath}`,
		`Agent/model: ${sourceSession.agent} / ${sourceSession.provider}:${sourceSession.model}`,
		'',
		'<session-context-to-summarize>',
		rawContext.trim() || 'No prior message context was available.',
		'</session-context-to-summarize>',
	].join('\n');
}

function clampHandoffSummary(summary: string): string {
	const trimmed = summary.trim();
	if (trimmed.length <= HANDOFF_MAX_CONTEXT_CHARS) return trimmed;
	return [
		trimmed.slice(0, HANDOFF_MAX_CONTEXT_CHARS).trimEnd(),
		'',
		'_Handoff summary truncated to fit context budget._',
	].join('\n');
}

export function normalizeHandoffSummary(summary: string): string {
	const trimmed = clampHandoffSummary(summary);
	if (trimmed.startsWith('# Handoff')) return trimmed;
	return ['# Handoff', '', trimmed].join('\n');
}

export function buildHandoffVisibleMessage(sourceSessionId: string): string {
	return [
		'🔁 **Handoff ready**',
		'',
		`This session was created from ${sourceSessionId}.`,
		'I have the previous session context loaded and can continue from here.',
	].join('\n');
}
