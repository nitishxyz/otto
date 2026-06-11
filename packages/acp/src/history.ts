import type {
	AgentSideConnection,
	SessionNotification,
} from '@agentclientprotocol/sdk';
import { listMessages } from '@ottocode/api';
import {
	extractReplayText,
	parseReplayImage,
	parseReplayToolCall,
	parseReplayToolResult,
} from './replay';
import {
	buildToolResultContent,
	formatToolTitle,
	getToolKind,
	getToolLocations,
} from './tools';
import { ensureAcpServer } from './server';
import type { AcpSession } from './types';

export async function replaySessionHistory(
	client: AgentSideConnection,
	sessionId: string,
	session: AcpSession,
): Promise<void> {
	await ensureAcpServer();
	const { data: history, error } = await listMessages({
		path: { id: session.ottoSessionId },
		query: { project: session.cwd },
	});
	if (error || !history) throw new Error('Failed to load session history');
	for (const message of history) {
		if (message.role !== 'user' && message.role !== 'assistant') continue;
		const parts = (message.parts ?? []).map((part) => ({
			...part,
			content:
				typeof part.content === 'string'
					? part.content
					: JSON.stringify(part.content),
		}));

		if (message.role === 'user') {
			await replayUserMessageParts(client, sessionId, parts);
		} else {
			await replayAssistantMessageParts(client, sessionId, parts, session);
		}
	}
}

async function replayUserMessageParts(
	client: AgentSideConnection,
	sessionId: string,
	parts: Array<{ type: string; content: string }>,
): Promise<void> {
	for (const part of parts) {
		if (part.type === 'text') {
			const text = extractReplayText([part]);
			if (!text) continue;
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: 'user_message_chunk',
					content: { type: 'text', text },
				},
			});
		} else if (part.type === 'image') {
			const image = parseReplayImage(part.content);
			if (!image) continue;
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: 'user_message_chunk',
					content: {
						type: 'image',
						data: image.data,
						mimeType: image.mediaType,
					},
				},
			});
		}
	}
}

async function replayAssistantMessageParts(
	client: AgentSideConnection,
	sessionId: string,
	parts: Array<{
		type: string;
		content: string;
		toolName?: string | null;
		toolCallId?: string | null;
		compactedAt?: number | null;
	}>,
	session: AcpSession,
): Promise<void> {
	const toolCalls = new Map<
		string,
		{ name: string; args: Record<string, unknown> | undefined }
	>();

	for (const part of parts) {
		if (part.type === 'text') {
			const text = extractReplayText([part]);
			if (!text) continue;
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'text', text },
				},
			});
			continue;
		}

		if (part.type === 'tool_call') {
			if (part.compactedAt) continue;
			const call = parseReplayToolCall(part);
			if (!call || call.name === 'finish') continue;
			toolCalls.set(call.callId, { name: call.name, args: call.args });
			await replayToolCall(client, sessionId, session, call);
			continue;
		}

		if (part.type === 'tool_result') {
			const result = parseReplayToolResult(part);
			if (!result || result.name === 'finish') continue;
			const call = toolCalls.get(result.callId);
			await replayToolResult(client, sessionId, session, result, call?.args);
		}
	}
}

async function replayToolCall(
	client: AgentSideConnection,
	sessionId: string,
	session: AcpSession,
	call: {
		name: string;
		callId: string;
		args: Record<string, unknown> | undefined;
	},
): Promise<void> {
	await client.sessionUpdate({
		sessionId,
		update: {
			toolCallId: call.callId,
			sessionUpdate: 'tool_call',
			title: formatToolTitle(call.name, call.args),
			kind: getToolKind(call.name),
			status: 'in_progress',
			rawInput: call.args,
			locations: getToolLocations(call.name, call.args, session.cwd),
		} as SessionNotification['update'],
	});
}

async function replayToolResult(
	client: AgentSideConnection,
	sessionId: string,
	session: AcpSession,
	result: { name: string; callId: string; result: unknown },
	args: Record<string, unknown> | undefined,
): Promise<void> {
	const output = result.result as Record<string, unknown> | string | undefined;
	const hasError =
		typeof output === 'object' &&
		output !== null &&
		'ok' in output &&
		output.ok === false;
	const content = buildToolResultContent(
		result.name,
		args,
		output,
		session.cwd,
	);

	await client.sessionUpdate({
		sessionId,
		update: {
			toolCallId: result.callId,
			sessionUpdate: 'tool_call_update',
			status: hasError ? 'failed' : 'completed',
			rawOutput: result.result,
			...(content.length > 0 ? { content } : {}),
			locations: getToolLocations(result.name, args, session.cwd, output),
		} as SessionNotification['update'],
	});
}
