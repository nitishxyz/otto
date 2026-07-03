import type { SharedSessionData, SharedMessagePart } from '../types';

const MAX_TOOL_CONTENT_CHARS = 2000;

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}

function prettyJson(content: string): string {
	try {
		return JSON.stringify(JSON.parse(content), null, 2);
	} catch {
		return content;
	}
}

function renderPart(part: SharedMessagePart): string | null {
	switch (part.type) {
		case 'text':
			return part.content;
		case 'tool_call':
			return [
				`**Tool call: ${part.toolName ?? 'unknown'}**`,
				'```json',
				truncate(prettyJson(part.content), MAX_TOOL_CONTENT_CHARS),
				'```',
			].join('\n');
		case 'tool_result':
			return [
				`**Tool result: ${part.toolName ?? 'unknown'}**`,
				'```',
				truncate(prettyJson(part.content), MAX_TOOL_CONTENT_CHARS),
				'```',
			].join('\n');
		case 'error':
			return `**Error:** ${part.content}`;
		case 'thinking':
			return null;
		default:
			return null;
	}
}

/** Renders a shared session as LLM-friendly markdown. */
export function sessionToMarkdown(
	data: SharedSessionData,
	meta: { shareId: string; description?: string | null },
): string {
	const lines: string[] = [];

	lines.push(`# ${data.title ?? 'otto session'}`);
	lines.push('');
	if (meta.description) {
		lines.push(meta.description);
		lines.push('');
	}
	lines.push(`- Share ID: ${meta.shareId}`);
	lines.push(`- Shared by: ${data.username}`);
	lines.push(`- Agent: ${data.agent}`);
	lines.push(`- Model: ${data.provider}/${data.model}`);
	lines.push(`- Created: ${new Date(data.createdAt).toISOString()}`);
	lines.push(`- Messages: ${data.messages.length}`);

	for (const message of data.messages) {
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push(`## ${message.role === 'user' ? 'User' : 'Assistant'}`);
		for (const part of message.parts) {
			const rendered = renderPart(part);
			if (rendered === null || rendered.trim() === '') continue;
			lines.push('');
			lines.push(rendered);
		}
	}

	lines.push('');
	return lines.join('\n');
}
