import type { Message, MessagePart } from '../types.ts';

export type StreamAction =
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

function getMessageText(message: Message): string | null {
	const textPart = message.parts?.find((part) => part.type === 'text');
	return textPart ? extractText(textPart) : null;
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

const MAX_TOOL_OUTPUT_CHARS = 4000;
const STREAM_INPUT_HEAD_CHARS = 2000;
const STREAM_INPUT_TAIL_CHARS = 6000;

function boundStreamedInput(value: string): string {
	const max = STREAM_INPUT_HEAD_CHARS + STREAM_INPUT_TAIL_CHARS;
	if (value.length <= max) return value;
	return `${value.slice(0, STREAM_INPUT_HEAD_CHARS)}\n…\n${value.slice(
		-STREAM_INPUT_TAIL_CHARS,
	)}`;
}

function applyToolInputDelta(
	state: Message[],
	payload: Record<string, unknown>,
): Message[] {
	const callId = typeof payload.callId === 'string' ? payload.callId : null;
	const delta = typeof payload.delta === 'string' ? payload.delta : null;
	if (!callId || !delta) return state;

	let changed = false;
	const next = state.map((msg) => {
		if (!msg.parts?.length) return msg;
		const partIdx = msg.parts.findIndex(
			(p) => p.ephemeral && p.toolCallId === callId && !p.completedAt,
		);
		if (partIdx === -1) return msg;
		changed = true;
		const parts = [...msg.parts];
		const part = parts[partIdx];
		const json =
			typeof part.contentJson === 'object' && !Array.isArray(part.contentJson)
				? (part.contentJson as Record<string, unknown>)
				: {};
		const prev =
			typeof json._streamedInput === 'string' ? json._streamedInput : '';
		const nextJson = {
			...json,
			_streamedInput: boundStreamedInput(prev + delta),
		};
		parts[partIdx] = { ...part, contentJson: nextJson };
		return { ...msg, parts };
	});
	return changed ? next : state;
}

function applyToolOutputDelta(
	state: Message[],
	payload: Record<string, unknown>,
): Message[] {
	const callId = typeof payload.callId === 'string' ? payload.callId : null;
	const delta = typeof payload.delta === 'string' ? payload.delta : null;
	if (!callId || !delta) return state;

	let changed = false;
	const next = state.map((msg) => {
		if (!msg.parts?.length) return msg;
		const partIdx = msg.parts.findIndex(
			(p) => p.ephemeral && p.toolCallId === callId && !p.completedAt,
		);
		if (partIdx === -1) return msg;
		changed = true;
		const parts = [...msg.parts];
		const part = parts[partIdx];
		const json =
			typeof part.contentJson === 'object' && !Array.isArray(part.contentJson)
				? (part.contentJson as Record<string, unknown>)
				: {};
		const prev = typeof json.outputStream === 'string' ? json.outputStream : '';
		const combined = (prev + delta).slice(-MAX_TOOL_OUTPUT_CHARS);
		const nextJson = { ...json, outputStream: combined };
		parts[partIdx] = { ...part, contentJson: nextJson };
		return { ...msg, parts };
	});
	return changed ? next : state;
}

/**
 * Pure reducer for the TUI message stream. Applies SSE-derived actions to
 * the in-memory message list, keeping optimistic user messages and streaming
 * assistant messages stable across server snapshots.
 */
export function messageReducer(
	state: Message[],
	action: StreamAction,
): Message[] {
	switch (action.type) {
		case 'LOAD': {
			const optimistic = state.filter((m) => m.id.startsWith('optimistic-'));
			const byId = new Map(state.map((m) => [m.id, m]));
			// Prefer the local copy for messages still streaming: SSE deltas keep
			// it ahead of the server snapshot, and swapping objects mid-stream
			// causes visible re-render flicker.
			const loaded = action.messages.map((m) => {
				const existing = byId.get(m.id);
				if (
					existing &&
					existing.role === 'assistant' &&
					existing.status === 'pending' &&
					m.status === 'pending'
				) {
					return existing;
				}
				return m;
			});
			if (optimistic.length === 0) return loaded;
			const unmatchedLoadedUserTexts = loaded.flatMap((message) => {
				if (message.role !== 'user') return [];
				const text = getMessageText(message);
				return text === null ? [] : [text];
			});
			const pending = optimistic.filter((message) => {
				const text = getMessageText(message);
				if (text === null) return true;
				const matchIndex = unmatchedLoadedUserTexts.indexOf(text);
				if (matchIndex === -1) return true;
				unmatchedLoadedUserTexts.splice(matchIndex, 1);
				return false;
			});
			return pending.length > 0 ? [...loaded, ...pending] : loaded;
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
			const content =
				typeof payload.content === 'string' ? payload.content : null;
			const optimisticIdx = state.findIndex(
				(m) =>
					m.id.startsWith('optimistic-') &&
					m.role === 'user' &&
					role === 'user' &&
					(content === null || getMessageText(m) === content),
			);
			let next = state;
			if (optimisticIdx !== -1 && role === 'user') {
				next = [...state];
				const optimistic = next[optimisticIdx];
				next[optimisticIdx] = {
					...optimistic,
					id,
					sessionId:
						typeof payload.sessionId === 'string'
							? payload.sessionId
							: optimistic.sessionId,
					agent:
						typeof payload.agent === 'string'
							? payload.agent
							: optimistic.agent,
					provider:
						typeof payload.provider === 'string'
							? payload.provider
							: optimistic.provider,
					model:
						typeof payload.model === 'string'
							? payload.model
							: optimistic.model,
					createdAt:
						typeof payload.createdAt === 'number'
							? payload.createdAt
							: optimistic.createdAt,
					completedAt:
						typeof payload.completedAt === 'number'
							? payload.completedAt
							: optimistic.completedAt,
					parts:
						optimistic.parts?.map((p) => ({
							...p,
							id: p.id.startsWith('optimistic-') ? `${id}-text` : p.id,
							messageId: id,
						})) ?? [],
				};
				return next;
			}
			const newMsg: Message = {
				id,
				sessionId:
					typeof payload.sessionId === 'string' ? payload.sessionId : '',
				role: role as Message['role'],
				status: role === 'user' ? 'complete' : 'pending',
				agent: typeof payload.agent === 'string' ? payload.agent : '',
				provider: typeof payload.provider === 'string' ? payload.provider : '',
				model: typeof payload.model === 'string' ? payload.model : '',
				createdAt:
					typeof payload.createdAt === 'number'
						? payload.createdAt
						: Date.now(),
				completedAt:
					typeof payload.completedAt === 'number' ? payload.completedAt : null,
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				error: null,
				attachmentNames: Array.isArray(payload.attachmentNames)
					? payload.attachmentNames.filter(
							(name): name is string => typeof name === 'string',
						)
					: undefined,
				parts:
					role === 'user' && content !== null
						? [
								{
									id: `${id}-text`,
									messageId: id,
									index: 0,
									stepIndex: null,
									type: 'text',
									content: JSON.stringify({ text: content }),
									contentJson: { text: content },
									agent: typeof payload.agent === 'string' ? payload.agent : '',
									provider:
										typeof payload.provider === 'string'
											? payload.provider
											: '',
									model: typeof payload.model === 'string' ? payload.model : '',
									startedAt:
										typeof payload.createdAt === 'number'
											? payload.createdAt
											: Date.now(),
									completedAt:
										typeof payload.completedAt === 'number'
											? payload.completedAt
											: Date.now(),
									toolName: null,
									toolCallId: null,
									toolDurationMs: null,
								},
							]
						: [],
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
			if (channel === 'input') {
				const withPart = messageReducer(state, { type: 'TOOL_CALL', payload });
				return applyToolInputDelta(withPart, payload);
			}
			if (channel === 'output' || channel === 'terminal') {
				return applyToolOutputDelta(state, payload);
			}
			return state;
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
