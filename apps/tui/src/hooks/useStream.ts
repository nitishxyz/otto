import { useEffect, useReducer, useRef, useState, useCallback } from 'react';
import {
	buildSessionStreamUrl,
	createSSEStream,
	listPendingSecureInputs,
	listMessages,
} from '@ottocode/api';
import { getBaseUrl } from '../api.ts';
import type {
	Message,
	MessagePart,
	PendingApproval,
	PendingSecureInput,
	SSEEvent,
} from '../types.ts';

type Action =
	| { type: 'LOAD'; messages: Message[] }
	| {
			type: 'ADD_OPTIMISTIC_USER';
			id: string;
			content: string;
			attachmentNames?: string[];
	  }
	| { type: 'MESSAGE_CREATED'; payload: Record<string, unknown> }
	| { type: 'TEXT_DELTA'; payload: Record<string, unknown> }
	| { type: 'REASONING_DELTA'; payload: Record<string, unknown> }
	| { type: 'TOOL_CALL'; payload: Record<string, unknown> }
	| { type: 'TOOL_DELTA'; payload: Record<string, unknown> }
	| { type: 'TOOL_RESULT'; payload: Record<string, unknown> }
	| { type: 'MESSAGE_COMPLETED'; payload: Record<string, unknown> }
	| { type: 'MESSAGE_UPDATED'; payload: Record<string, unknown> }
	| { type: 'ERROR'; payload: Record<string, unknown> }
	| { type: 'CLEAR' };

function extractText(part: MessagePart): string {
	if (
		part.contentJson &&
		typeof part.contentJson === 'object' &&
		!Array.isArray(part.contentJson) &&
		'text' in part.contentJson
	) {
		return String(part.contentJson.text ?? '');
	}
	if (typeof part.content === 'string') {
		try {
			const parsed = JSON.parse(part.content);
			if (parsed && typeof parsed.text === 'string') return parsed.text;
		} catch {}
		return part.content;
	}
	return '';
}

function applyDelta(
	messages: Message[],
	payload: Record<string, unknown>,
	partType: 'text' | 'reasoning',
): Message[] {
	const messageId =
		typeof payload.messageId === 'string' ? payload.messageId : null;
	const partId = typeof payload.partId === 'string' ? payload.partId : null;
	const delta = typeof payload.delta === 'string' ? payload.delta : null;
	if (!messageId || !partId || delta === null) return messages;

	const next = [...messages];
	const msgIdx = next.findIndex((m) => m.id === messageId);
	if (msgIdx === -1) return messages;

	const msg = next[msgIdx];
	const parts = msg.parts ? [...msg.parts] : [];
	const partIdx = parts.findIndex((p) => p.id === partId);
	const stepIndex =
		typeof payload.stepIndex === 'number' ? payload.stepIndex : null;

	if (partIdx === -1) {
		parts.push({
			id: partId,
			messageId,
			index: parts.length,
			stepIndex,
			type: partType,
			content: JSON.stringify({ text: delta }),
			contentJson: { text: delta },
			agent: msg.agent,
			provider: msg.provider,
			model: msg.model,
			startedAt: Date.now(),
			completedAt: null,
			toolName: null,
			toolCallId: null,
			toolDurationMs: null,
		});
	} else {
		const existing = parts[partIdx];
		const prev = extractText(existing);
		const nextText = `${prev}${delta}`;
		parts[partIdx] = {
			...existing,
			content: JSON.stringify({ text: nextText }),
			contentJson: { text: nextText },
			stepIndex: stepIndex ?? existing.stepIndex ?? null,
		};
	}

	next[msgIdx] = { ...msg, parts };
	return next;
}

function messageReducer(state: Message[], action: Action): Message[] {
	switch (action.type) {
		case 'LOAD': {
			const optimistic = state.filter((m) => m.id.startsWith('optimistic-'));
			if (optimistic.length === 0) return action.messages;
			const loaded = action.messages;
			const hasUserMsg = loaded.some((m) => m.role === 'user');
			if (hasUserMsg) return loaded;
			return [...optimistic, ...loaded];
		}
		case 'CLEAR':
			return [];

		case 'ADD_OPTIMISTIC_USER': {
			if (state.some((m) => m.id === action.id)) return state;
			const userMsg: Message = {
				id: action.id,
				sessionId: '',
				role: 'user',
				status: 'complete',
				agent: '',
				provider: '',
				model: '',
				createdAt: Date.now(),
				completedAt: Date.now(),
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				error: null,
				attachmentNames: action.attachmentNames,
				parts: [
					{
						id: `${action.id}-text`,
						messageId: action.id,
						index: 0,
						stepIndex: null,
						type: 'text',
						content: JSON.stringify({ text: action.content }),
						contentJson: { text: action.content },
						agent: '',
						provider: '',
						model: '',
						startedAt: Date.now(),
						completedAt: Date.now(),
						toolName: null,
						toolCallId: null,
						toolDurationMs: null,
					},
				],
			};
			return [...state, userMsg];
		}

		case 'MESSAGE_CREATED': {
			const { payload } = action;
			const id = typeof payload.id === 'string' ? payload.id : null;
			const role = typeof payload.role === 'string' ? payload.role : null;
			if (!id || !role) return state;
			if (state.some((m) => m.id === id)) return state;
			const optimisticIdx = state.findIndex(
				(m) =>
					m.id.startsWith('optimistic-') &&
					m.role === 'user' &&
					role === 'user',
			);
			let next = state;
			if (optimisticIdx !== -1 && role === 'user') {
				next = [...state];
				next[optimisticIdx] = {
					...next[optimisticIdx],
					id,
					parts:
						next[optimisticIdx].parts?.map((p) => ({
							...p,
							id: p.id.startsWith('optimistic-') ? `${id}-text` : p.id,
							messageId: id,
						})) ?? [],
				};
				return next;
			}
			const newMsg: Message = {
				id,
				sessionId: '',
				role: role as Message['role'],
				status: 'pending',
				agent: typeof payload.agent === 'string' ? payload.agent : '',
				provider: typeof payload.provider === 'string' ? payload.provider : '',
				model: typeof payload.model === 'string' ? payload.model : '',
				createdAt: Date.now(),
				completedAt: null,
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				error: null,
				parts: [],
			};
			return [...state, newMsg];
		}

		case 'TEXT_DELTA':
			return applyDelta(state, action.payload, 'text');

		case 'REASONING_DELTA':
			return applyDelta(state, action.payload, 'reasoning');

		case 'TOOL_CALL': {
			const { payload } = action;
			const callId = typeof payload.callId === 'string' ? payload.callId : null;
			const name = typeof payload.name === 'string' ? payload.name : null;
			const messageId =
				typeof payload.messageId === 'string' ? payload.messageId : null;
			if (!name) return state;

			const next = [...state];
			let targetIdx = -1;
			if (messageId) {
				targetIdx = next.findIndex((m) => m.id === messageId);
			}
			if (targetIdx === -1) {
				for (let i = next.length - 1; i >= 0; i--) {
					if (next[i].role === 'assistant' && next[i].status !== 'complete') {
						targetIdx = i;
						break;
					}
				}
			}
			if (targetIdx === -1) return state;

			const msg = next[targetIdx];
			const parts = msg.parts ? [...msg.parts] : [];
			const args = (payload as { args?: unknown }).args;
			const stepIndex =
				typeof payload.stepIndex === 'number' ? payload.stepIndex : null;
			const contentJson: Record<string, unknown> = { name };
			if (callId) contentJson.callId = callId;
			if (args !== undefined) contentJson.args = args;

			const existingIdx = callId
				? parts.findIndex((p) => p.toolCallId === callId && p.ephemeral)
				: -1;

			if (existingIdx === -1) {
				parts.push({
					id: callId
						? `ephemeral-${callId}`
						: `ephemeral-${name}-${Date.now()}`,
					messageId: msg.id,
					index: parts.length,
					stepIndex,
					type: 'tool_call',
					content: JSON.stringify(contentJson),
					contentJson,
					agent: msg.agent,
					provider: msg.provider,
					model: msg.model,
					startedAt: Date.now(),
					completedAt: null,
					toolName: name,
					toolCallId: callId,
					toolDurationMs: null,
					ephemeral: true,
				});
			} else {
				const existing = parts[existingIdx];
				const nextJson: Record<string, unknown> = {
					...(typeof existing.contentJson === 'object' &&
					!Array.isArray(existing.contentJson)
						? (existing.contentJson as Record<string, unknown>)
						: {}),
					name,
				};
				if (callId) nextJson.callId = callId;
				if (args !== undefined) nextJson.args = args;
				parts[existingIdx] = {
					...existing,
					content: JSON.stringify(nextJson),
					contentJson: nextJson,
					toolCallId: callId ?? existing.toolCallId,
					toolName: name,
					stepIndex: stepIndex ?? existing.stepIndex ?? null,
				};
			}

			next[targetIdx] = { ...msg, parts };
			return next;
		}

		case 'TOOL_DELTA': {
			const { payload } = action;
			const channel =
				typeof payload.channel === 'string' ? payload.channel : null;
			if (channel !== 'input') return state;
			return messageReducer(state, { type: 'TOOL_CALL', payload });
		}

		case 'TOOL_RESULT': {
			const { payload } = action;
			const callId = typeof payload.callId === 'string' ? payload.callId : null;
			if (!callId) return state;
			const result = payload.result !== undefined ? payload.result : undefined;
			const artifact =
				payload.artifact !== undefined ? payload.artifact : undefined;
			let changed = false;
			const next = state.map((msg) => {
				if (!msg.parts?.length) return msg;
				const updatedParts = msg.parts.map((p) => {
					if (p.ephemeral && p.toolCallId === callId) {
						changed = true;
						const updatedJson = {
							...(typeof p.contentJson === 'object' &&
							!Array.isArray(p.contentJson)
								? (p.contentJson as Record<string, unknown>)
								: {}),
							...(result !== undefined ? { result } : {}),
							...(artifact !== undefined ? { artifact } : {}),
						};
						const now = Date.now();
						const durationMs = p.startedAt ? now - p.startedAt : null;
						return {
							...p,
							completedAt: now,
							toolDurationMs: durationMs,
							contentJson: updatedJson,
							content: JSON.stringify(updatedJson),
						};
					}
					return p;
				});
				return changed ? { ...msg, parts: updatedParts } : msg;
			});
			return changed ? next : state;
		}

		case 'MESSAGE_COMPLETED': {
			const { payload } = action;
			const id = typeof payload.id === 'string' ? payload.id : null;
			if (!id) return state;
			const next = [...state];
			const idx = next.findIndex((m) => m.id === id);
			if (idx === -1) return state;
			const msg = next[idx];
			next[idx] = {
				...msg,
				status: 'complete',
				completedAt: Date.now(),
				promptTokens:
					typeof payload.promptTokens === 'number'
						? payload.promptTokens
						: msg.promptTokens,
				completionTokens:
					typeof payload.completionTokens === 'number'
						? payload.completionTokens
						: msg.completionTokens,
				totalTokens:
					typeof payload.totalTokens === 'number'
						? payload.totalTokens
						: msg.totalTokens,
				parts: msg.parts ?? [],
			};
			return next;
		}

		case 'MESSAGE_UPDATED': {
			const { payload } = action;
			const id = typeof payload.id === 'string' ? payload.id : null;
			const status = typeof payload.status === 'string' ? payload.status : null;
			if (!id || !status) return state;
			const next = [...state];
			const idx = next.findIndex((m) => m.id === id);
			if (idx === -1) return state;
			next[idx] = { ...next[idx], status: status as Message['status'] };
			return next;
		}

		case 'ERROR': {
			const { payload } = action;
			const messageId =
				typeof payload.messageId === 'string' ? payload.messageId : null;
			if (!messageId) {
				const errorText =
					typeof payload.error === 'string'
						? payload.error
						: typeof payload.message === 'string'
							? payload.message
							: 'Unknown error';
				const errMsg: Message = {
					id: `error-${Date.now()}`,
					sessionId: '',
					role: 'assistant',
					status: 'error',
					agent: '',
					provider: '',
					model: '',
					createdAt: Date.now(),
					completedAt: Date.now(),
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					error: errorText,
					parts: [
						{
							id: `error-part-${Date.now()}`,
							messageId: `error-${Date.now()}`,
							index: 0,
							stepIndex: null,
							type: 'error',
							content: JSON.stringify({ text: errorText }),
							contentJson: { text: errorText },
							agent: '',
							provider: '',
							model: '',
							startedAt: Date.now(),
							completedAt: Date.now(),
							toolName: null,
							toolCallId: null,
							toolDurationMs: null,
						},
					],
				};
				return [...state, errMsg];
			}
			const next = [...state];
			const idx = next.findIndex((m) => m.id === messageId);
			if (idx === -1) return state;
			const msg = next[idx];
			next[idx] = {
				...msg,
				status: 'error',
				error:
					typeof payload.error === 'string'
						? payload.error
						: typeof payload.message === 'string'
							? payload.message
							: typeof payload.error === 'object' && payload.error
								? JSON.stringify(payload.error)
								: JSON.stringify(payload),
				parts: msg.parts ?? [],
			};
			return next;
		}

		default:
			return state;
	}
}

async function loadSessionMessages(sessionId: string) {
	const response = await listMessages({ path: { id: sessionId } });
	if (response.error) throw new Error(JSON.stringify(response.error));
	return (response.data ?? []) as Message[];
}

async function loadPendingSecureInputs(sessionId: string) {
	const response = await listPendingSecureInputs({ path: { id: sessionId } });
	if (response.error) return [];
	return Array.isArray(response.data?.pending)
		? (response.data.pending as PendingSecureInput[])
		: [];
}

async function connectSSE(
	url: string,
	signal: AbortSignal,
	onEvent: (event: SSEEvent) => void,
) {
	const parsedUrl = new URL(url);
	await createSSEStream(
		{
			baseUrl: parsedUrl.origin,
			sessionId: parsedUrl.pathname.split('/').at(-2) ?? '',
			projectPath: parsedUrl.searchParams.get('project') ?? undefined,
			onEvent: (event) => {
				try {
					onEvent({
						type: event.event ?? 'message',
						payload: JSON.parse(event.data),
					});
				} catch {}
			},
		},
		signal,
	);
}

export function useStream(
	sessionId: string | null,
	onSessionUpdate?: (payload: Record<string, unknown>) => void,
	onMessageCompleted?: () => void,
	onStepFinish?: () => void,
) {
	const [messages, dispatch] = useReducer(messageReducer, []);
	const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
		null,
	);
	const [queueSize, setQueueSize] = useState(0);
	const [queuedMessageIds, setQueuedMessageIds] = useState<Set<string>>(
		new Set(),
	);
	const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>(
		[],
	);
	const [pendingSecureInputs, setPendingSecureInputs] = useState<
		PendingSecureInput[]
	>([]);
	const abortRef = useRef<AbortController | null>(null);
	const onSessionUpdateRef = useRef(onSessionUpdate);
	onSessionUpdateRef.current = onSessionUpdate;
	const onMessageCompletedRef = useRef(onMessageCompleted);
	onMessageCompletedRef.current = onMessageCompleted;
	const onStepFinishRef = useRef(onStepFinish);
	onStepFinishRef.current = onStepFinish;

	const addOptimisticUser = useCallback(
		(content: string, attachmentNames?: string[]) => {
			const id = `optimistic-${Date.now()}`;
			dispatch({ type: 'ADD_OPTIMISTIC_USER', id, content, attachmentNames });
		},
		[],
	);

	useEffect(() => {
		if (!sessionId) {
			dispatch({ type: 'CLEAR' });
			setPendingSecureInputs([]);
			return;
		}

		const controller = new AbortController();
		abortRef.current = controller;
		const baseUrl = getBaseUrl();

		loadSessionMessages(sessionId)
			.then((messages) => dispatch({ type: 'LOAD', messages }))
			.catch(() => {});
		loadPendingSecureInputs(sessionId)
			.then(setPendingSecureInputs)
			.catch(() => setPendingSecureInputs([]));

		const streamUrl = buildSessionStreamUrl({ baseUrl, sessionId });
		connectSSE(streamUrl, controller.signal, (event) => {
			const payload = event.payload as Record<string, unknown>;

			switch (event.type) {
				case 'message.created':
					dispatch({ type: 'MESSAGE_CREATED', payload });
					if (payload.role === 'assistant') {
						const id = typeof payload.id === 'string' ? payload.id : null;
						if (id) setStreamingMessageId((prev) => prev ?? id);
					}
					break;
				case 'message.part.delta':
					dispatch({ type: 'TEXT_DELTA', payload });
					break;
				case 'reasoning.delta':
					dispatch({ type: 'REASONING_DELTA', payload });
					break;
				case 'tool.call':
					dispatch({ type: 'TOOL_CALL', payload });
					break;
				case 'tool.delta':
					dispatch({ type: 'TOOL_DELTA', payload });
					break;
				case 'tool.result':
					dispatch({ type: 'TOOL_RESULT', payload });
					break;
				case 'tool.approval.required': {
					const callId =
						typeof payload.callId === 'string' ? payload.callId : '';
					const toolName =
						typeof payload.toolName === 'string' ? payload.toolName : '';
					const messageId =
						typeof payload.messageId === 'string' ? payload.messageId : '';
					if (callId && toolName && messageId) {
						setPendingApprovals((prev) => {
							if (prev.some((a) => a.callId === callId)) return prev;
							return [
								...prev,
								{ callId, toolName, args: payload.args, messageId },
							];
						});
					}
					break;
				}
				case 'tool.approval.resolved': {
					const resolvedCallId =
						typeof payload.callId === 'string' ? payload.callId : '';
					if (resolvedCallId) {
						setPendingApprovals((prev) =>
							prev.filter((a) => a.callId !== resolvedCallId),
						);
					} else {
						setPendingApprovals([]);
					}
					break;
				}
				case 'shell.secure_input.required': {
					const promptId =
						typeof payload.promptId === 'string' ? payload.promptId : '';
					const prompt =
						typeof payload.prompt === 'string' ? payload.prompt : '';
					if (promptId && prompt) {
						setPendingSecureInputs((prev) => {
							if (prev.some((input) => input.promptId === promptId)) {
								return prev;
							}
							return [
								...prev,
								{
									promptId,
									prompt,
									messageId:
										typeof payload.messageId === 'string'
											? payload.messageId
											: undefined,
									callId:
										typeof payload.callId === 'string'
											? payload.callId
											: undefined,
									inputKind: 'password',
									createdAt: Date.now(),
								},
							];
						});
					}
					break;
				}
				case 'shell.secure_input.resolved': {
					const promptId =
						typeof payload.promptId === 'string' ? payload.promptId : '';
					if (promptId) {
						setPendingSecureInputs((prev) =>
							prev.filter((input) => input.promptId !== promptId),
						);
					}
					break;
				}
				case 'message.completed':
					dispatch({ type: 'MESSAGE_COMPLETED', payload });
					setStreamingMessageId(null);
					onMessageCompletedRef.current?.();
					setTimeout(() => {
						loadSessionMessages(sessionId)
							.then((messages) => dispatch({ type: 'LOAD', messages }))
							.catch(() => {});
					}, 300);
					break;
				case 'message.updated':
					dispatch({ type: 'MESSAGE_UPDATED', payload });
					break;
				case 'error':
					dispatch({ type: 'ERROR', payload });
					setStreamingMessageId(null);
					break;
				case 'session.updated': {
					onSessionUpdateRef.current?.(payload);
					break;
				}
				case 'queue.updated': {
					const queueLength =
						typeof payload.queueLength === 'number' ? payload.queueLength : 0;
					setQueueSize(queueLength);
					const currentMsgId =
						typeof payload.currentMessageId === 'string'
							? payload.currentMessageId
							: null;
					if (currentMsgId) setStreamingMessageId(currentMsgId);
					const queuedMsgs = Array.isArray(payload.queuedMessages)
						? payload.queuedMessages
						: [];
					const nextIds = queuedMsgs.map(
						(q: { messageId: string }) => q.messageId,
					);
					setQueuedMessageIds((prev) => {
						if (
							prev.size === nextIds.length &&
							nextIds.every((id: string) => prev.has(id))
						) {
							return prev;
						}
						return new Set(nextIds);
					});
					break;
				}
				case 'finish-step': {
					onStepFinishRef.current?.();
					break;
				}
			}
		});

		return () => {
			controller.abort();
			abortRef.current = null;
		};
	}, [sessionId]);

	const reload = () => {
		if (!sessionId) return;
		loadSessionMessages(sessionId)
			.then((messages) => dispatch({ type: 'LOAD', messages }))
			.catch(() => {});
	};

	const isStreaming = streamingMessageId !== null;
	return {
		messages,
		isStreaming,
		streamingMessageId,
		queueSize,
		queuedMessageIds,
		pendingApprovals,
		setPendingApprovals,
		pendingSecureInputs,
		setPendingSecureInputs,
		reload,
		dispatch,
		addOptimisticUser,
	};
}
