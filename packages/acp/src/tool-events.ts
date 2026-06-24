import type {
	AgentSideConnection,
	SessionNotification,
} from '@agentclientprotocol/sdk';
import { randomUUID } from 'node:crypto';
import {
	buildToolResultContent,
	formatToolTitle,
	getToolKind,
	getToolLocations,
	isShellTool,
} from './tools';
import type { AcpSession } from './types';

export async function handleToolCall(
	client: AgentSideConnection,
	payload: Record<string, unknown> | undefined,
	acpSessionId: string,
	session: AcpSession,
): Promise<void> {
	const name = typeof payload?.name === 'string' ? payload.name : 'tool';
	const callId =
		typeof payload?.callId === 'string' ? payload.callId : randomUUID();
	const args = payload?.args as Record<string, unknown> | undefined;

	const kind = getToolKind(name);
	const locations = getToolLocations(name, args, session.cwd);
	const update = session.streamedToolCalls.has(callId)
		? {
				toolCallId: callId,
				sessionUpdate: 'tool_call_update',
				title: formatToolTitle(name, args),
				kind,
				status: 'in_progress',
				rawInput: args,
				locations,
			}
		: {
				toolCallId: callId,
				sessionUpdate: 'tool_call',
				title: formatToolTitle(name, args),
				kind,
				status: 'in_progress',
				rawInput: args,
				locations,
			};
	session.streamedToolCalls.add(callId);
	if (isShellTool(name)) {
		session.streamedToolContent.set(callId, '');
	}

	await client.sessionUpdate({
		sessionId: acpSessionId,
		update: update as SessionNotification['update'],
	});
}

export async function handleToolDelta(
	client: AgentSideConnection,
	payload: Record<string, unknown> | undefined,
	acpSessionId: string,
	session: AcpSession,
): Promise<void> {
	const callId =
		typeof payload?.callId === 'string' ? payload.callId : undefined;
	if (!callId) return;

	const name = typeof payload?.name === 'string' ? payload.name : '';
	const channel = typeof payload?.channel === 'string' ? payload.channel : '';
	const delta = payload?.delta;

	if (!session.streamedToolCalls.has(callId)) {
		session.streamedToolCalls.add(callId);
		await client.sessionUpdate({
			sessionId: acpSessionId,
			update: {
				toolCallId: callId,
				sessionUpdate: 'tool_call',
				title: formatToolTitle(name, undefined),
				kind: getToolKind(name),
				status: channel === 'input' ? 'pending' : 'in_progress',
			} as SessionNotification['update'],
		});
	}

	if (channel === 'input') return;

	if (
		isShellTool(name) &&
		channel === 'terminal' &&
		typeof delta === 'string'
	) {
		session.terminalToolCalls.set(callId, delta);
		await client.sessionUpdate({
			sessionId: acpSessionId,
			update: {
				toolCallId: callId,
				sessionUpdate: 'tool_call_update',
				content: [{ type: 'terminal', terminalId: delta }],
			} as SessionNotification['update'],
		});
		return;
	}

	if (isShellTool(name) && typeof delta === 'string' && delta) {
		const text = truncate(
			`${session.streamedToolContent.get(callId) ?? ''}${delta}`,
			20000,
		);
		session.streamedToolContent.set(callId, text);
		await client.sessionUpdate({
			sessionId: acpSessionId,
			update: {
				toolCallId: callId,
				sessionUpdate: 'tool_call_update',
				content: [
					{
						type: 'content',
						content: { type: 'text', text },
					},
				],
			} as SessionNotification['update'],
		});
	}
}

export async function handleToolResult(
	client: AgentSideConnection,
	payload: Record<string, unknown> | undefined,
	acpSessionId: string,
	session: AcpSession,
): Promise<void> {
	const callId =
		typeof payload?.callId === 'string' ? payload.callId : undefined;
	if (!callId) return;

	const name = typeof payload?.name === 'string' ? payload.name : '';
	const result = payload?.result as
		| Record<string, unknown>
		| string
		| undefined;
	const args = payload?.args as Record<string, unknown> | undefined;

	const hasError =
		payload?.error ||
		(typeof result === 'object' &&
			result !== null &&
			'ok' in result &&
			result.ok === false);

	const terminalId = session.terminalToolCalls.get(callId);
	const content = terminalId
		? [{ type: 'terminal', terminalId }]
		: buildToolResultContent(name, args, result, session.cwd);
	const locations = getToolLocations(name, args, session.cwd, result);
	session.streamedToolCalls.delete(callId);
	session.streamedToolContent.delete(callId);
	session.terminalToolCalls.delete(callId);

	await client.sessionUpdate({
		sessionId: acpSessionId,
		update: {
			toolCallId: callId,
			sessionUpdate: 'tool_call_update',
			status: hasError ? 'failed' : 'completed',
			...(typeof result === 'object' && result !== null
				? { rawOutput: result }
				: {}),
			...(content.length > 0 ? { content } : {}),
			...(locations.length > 0 ? { locations } : {}),
		} as SessionNotification['update'],
	});
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `…${text.slice(text.length - max + 1)}`;
}
