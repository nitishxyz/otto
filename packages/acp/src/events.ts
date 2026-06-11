import type {
	AgentSideConnection,
	ClientCapabilities,
	Usage,
} from '@agentclientprotocol/sdk';
import { resolveApproval } from '@ottocode/server/runtime/tools/approval';
import type { OttoEvent } from '@ottocode/server/events/types';
import { getSession as apiGetSession } from '@ottocode/api';
import {
	estimateModelCostUsd,
	getModelInfo,
	type ProviderId,
} from '@ottocode/sdk';
import { getToolLocations, mapPlanStatus } from './tools';
import {
	handleToolCall,
	handleToolDelta,
	handleToolResult,
} from './tool-events';
import type { AcpSession } from './types';
import { isConnectionClosedError } from './errors';

export async function handleOttoEvent(
	client: AgentSideConnection,
	clientCapabilities: ClientCapabilities | undefined,
	event: OttoEvent,
	acpSessionId: string,
	session: AcpSession,
): Promise<void> {
	if (session.cancelled) return;

	const payload = event.payload as Record<string, unknown> | undefined;

	try {
		switch (event.type) {
			case 'session.updated': {
				const title =
					typeof payload?.title === 'string' ? payload.title : undefined;
				if (title) {
					await client.sessionUpdate({
						sessionId: acpSessionId,
						update: {
							sessionUpdate: 'session_info_update',
							title,
							updatedAt: new Date().toISOString(),
						},
					});
				}
				break;
			}

			case 'message.part.delta': {
				const delta = typeof payload?.delta === 'string' ? payload.delta : '';
				if (delta && payload?.messageId === session.assistantMessageId) {
					await client.sessionUpdate({
						sessionId: acpSessionId,
						update: {
							sessionUpdate: 'agent_message_chunk',
							content: { type: 'text', text: delta },
						},
					});
				}
				break;
			}

			case 'reasoning.delta': {
				const delta = typeof payload?.delta === 'string' ? payload.delta : '';
				const messageId =
					typeof payload?.messageId === 'string'
						? payload.messageId
						: session.assistantMessageId;
				if (delta) {
					await client.sessionUpdate({
						sessionId: acpSessionId,
						update: {
							sessionUpdate: 'agent_thought_chunk',
							...(messageId ? { messageId } : {}),
							content: { type: 'text', text: delta },
						},
					});
				}
				break;
			}

			case 'tool.call': {
				if (payload?.name === 'progress_update') {
					await handleProgressUpdate(client, payload, acpSessionId, session);
					break;
				}
				await handleToolCall(client, payload, acpSessionId, session);
				break;
			}

			case 'tool.delta': {
				if (payload?.name === 'progress_update') {
					break;
				}
				await handleToolDelta(client, payload, acpSessionId, session);
				break;
			}

			case 'tool.result': {
				if (payload?.name === 'progress_update') {
					break;
				}
				await handleToolResult(
					client,
					clientCapabilities,
					payload,
					acpSessionId,
					session,
				);
				break;
			}

			case 'plan.updated': {
				const items = payload?.items as
					| Array<{ step: string; status?: string }>
					| undefined;
				if (items) {
					await client.sessionUpdate({
						sessionId: acpSessionId,
						update: {
							sessionUpdate: 'plan',
							entries: items.map((item) => ({
								content: item.step,
								priority: 'medium',
								status: mapPlanStatus(item.status),
							})),
						},
					});
				}
				break;
			}

			case 'tool.approval.required': {
				const callId =
					typeof payload?.callId === 'string' ? payload.callId : undefined;
				const toolName =
					typeof payload?.toolName === 'string' ? payload.toolName : 'tool';
				const args = payload?.args as Record<string, unknown> | undefined;

				if (!callId) break;

				const response = await client.requestPermission({
					options: [
						{
							kind: 'allow_once',
							name: 'Allow',
							optionId: 'allow',
						},
						{
							kind: 'reject_once',
							name: 'Reject',
							optionId: 'reject',
						},
					],
					sessionId: acpSessionId,
					toolCall: {
						toolCallId: callId,
						title: toolName,
						rawInput: args,
						locations: getToolLocations(toolName, args, session.cwd),
					},
				});

				const approved =
					response.outcome?.outcome === 'selected' &&
					response.outcome.optionId === 'allow';

				resolveApproval(callId, approved);
				return;
			}

			case 'message.completed': {
				await sendUsageUpdate(client, payload, acpSessionId, session);
				if (
					payload?.id === session.assistantMessageId &&
					session.resolvePrompt
				) {
					const resolve = session.resolvePrompt;
					session.resolvePrompt = null;
					session.unsubscribe?.();
					session.unsubscribe = null;
					const usage = extractTurnUsage(payload);
					resolve({
						stopReason: 'end_turn',
						...(usage ? { usage } : {}),
					});
				}
				return;
			}

			case 'error': {
				const errorText =
					typeof payload?.error === 'string'
						? payload.error
						: typeof payload?.message === 'string'
							? payload.message
							: 'Unknown error';

				await client.sessionUpdate({
					sessionId: acpSessionId,
					update: {
						sessionUpdate: 'agent_message_chunk',
						content: { type: 'text', text: `\n\nError: ${errorText}\n` },
					},
				});
				break;
			}

			default:
				return;
		}
	} catch (err) {
		if (isConnectionClosedError(err)) return;
		console.error('[acp] Error handling event:', event.type, err);
	}
}

async function handleProgressUpdate(
	client: AgentSideConnection,
	payload: Record<string, unknown> | undefined,
	acpSessionId: string,
	session: AcpSession,
): Promise<void> {
	const args = payload?.args as Record<string, unknown> | undefined;
	const message = typeof args?.message === 'string' ? args.message.trim() : '';
	if (!message) return;

	await client.sessionUpdate({
		sessionId: acpSessionId,
		update: {
			sessionUpdate: 'agent_thought_chunk',
			...(session.assistantMessageId
				? { messageId: session.assistantMessageId }
				: {}),
			content: { type: 'text', text: `${message}\n` },
		},
	});
}

type CompletedUsagePayload = {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cachedInputTokens?: number;
	cacheCreationInputTokens?: number;
};

function readUsagePayload(
	payload: Record<string, unknown> | undefined,
): CompletedUsagePayload | undefined {
	const usage = payload?.usage;
	if (!usage || typeof usage !== 'object') return undefined;
	return usage as CompletedUsagePayload;
}

function extractTurnUsage(
	payload: Record<string, unknown> | undefined,
): Usage | undefined {
	const usage = readUsagePayload(payload);
	if (!usage) return undefined;
	const inputTokens = Number(usage.inputTokens ?? 0);
	const outputTokens = Number(usage.outputTokens ?? 0);
	const totalTokens = Number(usage.totalTokens ?? inputTokens + outputTokens);
	if (!inputTokens && !outputTokens && !totalTokens) return undefined;
	return {
		inputTokens,
		outputTokens,
		totalTokens,
		cachedReadTokens: Number(usage.cachedInputTokens ?? 0),
		cachedWriteTokens: Number(usage.cacheCreationInputTokens ?? 0),
	};
}

/**
 * Sends a `usage_update` session notification (context window utilization and
 * cumulative cost) after a turn completes, per the ACP Session Context Size
 * and Cost RFD. Skipped when the model's context window size is unknown.
 */
async function sendUsageUpdate(
	client: AgentSideConnection,
	payload: Record<string, unknown> | undefined,
	acpSessionId: string,
	session: AcpSession,
): Promise<void> {
	if (!session.provider || !session.model) return;
	const size = getModelInfo(session.provider as ProviderId, session.model)
		?.limit?.context;
	if (!size || size <= 0) return;

	let used = 0;
	let costUsd: number | undefined;
	if (session.ottoSessionId) {
		const { data: row } = await apiGetSession({
			path: { sessionId: session.ottoSessionId },
			query: { project: session.cwd },
		}).catch(() => ({ data: undefined }));
		if (row) {
			used = Number(row.currentContextTokens ?? 0);
			costUsd = estimateModelCostUsd(
				session.provider as ProviderId,
				session.model,
				{
					inputTokens: Number(row.totalInputTokens ?? 0),
					outputTokens: Number(row.totalOutputTokens ?? 0),
					cachedInputTokens: Number(row.totalCachedTokens ?? 0),
					cacheCreationInputTokens: Number(row.totalCacheCreationTokens ?? 0),
				},
			);
		}
	}
	if (!used) {
		const usage = readUsagePayload(payload);
		if (!usage) return;
		used = Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0);
		if (costUsd === undefined && typeof payload?.costUsd === 'number') {
			costUsd = payload.costUsd;
		}
	}
	if (!used) return;

	await client.sessionUpdate({
		sessionId: acpSessionId,
		update: {
			sessionUpdate: 'usage_update',
			used: Math.min(used, size),
			size,
			...(costUsd !== undefined
				? { cost: { amount: costUsd, currency: 'USD' } }
				: {}),
		},
	});
}
