import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SSEClient } from '../lib/sse-client';
import { apiClient } from '../lib/api-client';
import type { Message, MessagePart } from '../types/api';
import { useToolApprovalStore } from '../stores/toolApprovalStore';
import { useViewerTabsStore } from '../stores/viewerTabsStore';
import { sessionsQueryKey } from './useSessions';

const TOOL_PREVIEW_THROTTLE_MS = 500;
const TOOL_PREVIEW_THROTTLE_MIN_CHARS = 8_000;
const TOOL_PREVIEW_THROTTLE_MIN_DELTA_CHARS = 16_000;
const STREAMING_WRITE_CONTENT_PREVIEW_CHARS = 24_000;
const STREAMING_PATCH_PREVIEW_HEAD_CHARS = 12_000;
const STREAMING_PATCH_PREVIEW_TAIL_CHARS = 24_000;
const STREAMING_TOOL_INPUT_HEAD_CHARS = 8_000;
const STREAMING_TOOL_INPUT_TAIL_CHARS = 16_000;
const STREAMING_TOOL_MESSAGE_THROTTLE_MS = 500;

export function useSessionStream(
	sessionId: string | undefined,
	enabled = true,
) {
	const queryClient = useQueryClient();
	const clientRef = useRef<SSEClient | null>(null);
	const assistantMessageIdRef = useRef<string | null>(null);
	const toolInputBuffersRef = useRef<Map<string, string>>(new Map());
	const toolPreviewEmitRef = useRef<
		Map<string, { emittedAt: number; contentLength: number }>
	>(new Map());
	const toolMessageEmitRef = useRef<Map<string, number>>(new Map());

	const {
		addPendingApproval,
		removePendingApproval,
		updatePendingApproval,
		setPendingApprovals,
	} = useToolApprovalStore();

	useEffect(() => {
		if (!sessionId || !enabled) {
			return;
		}

		assistantMessageIdRef.current = null;
		toolInputBuffersRef.current.clear();
		toolPreviewEmitRef.current.clear();
		toolMessageEmitRef.current.clear();
		let lastSessionInvalidation = 0;

		// Fetch pending approvals from server for this session
		apiClient
			.getPendingApprovals(sessionId)
			.then((result) => {
				if (result.ok && result.pending.length > 0) {
					setPendingApprovals(result.pending);
				} else {
					setPendingApprovals([]);
				}
			})
			.catch(() => {
				setPendingApprovals([]);
			});

		const client = new SSEClient();
		clientRef.current = client;

		const url = apiClient.getStreamUrl(sessionId);
		console.log('[useSessionStream] Connecting to stream:', url);
		client.connect(url);

		const resolveAssistantTargetIndex = (messages: Message[]): number => {
			if (assistantMessageIdRef.current) {
				const byId = messages.findIndex(
					(message) => message.id === assistantMessageIdRef.current,
				);
				if (byId !== -1) return byId;
			}
			for (let i = messages.length - 1; i >= 0; i -= 1) {
				const candidate = messages[i];
				if (candidate.role === 'assistant' && candidate.status === 'pending') {
					return i;
				}
			}
			return -1;
		};

		const extractText = (part: MessagePart): string => {
			if (
				part.contentJson &&
				typeof part.contentJson === 'object' &&
				!Array.isArray(part.contentJson) &&
				'text' in part.contentJson
			) {
				return String((part.contentJson as Record<string, unknown>).text ?? '');
			}
			if (typeof part.content === 'string') {
				try {
					const parsed = JSON.parse(part.content);
					if (parsed && typeof parsed.text === 'string') return parsed.text;
				} catch {}
				return part.content;
			}
			return '';
		};

		const getToolEventCallId = (
			payload: Record<string, unknown> | undefined,
		): string | null => {
			if (typeof payload?.callId === 'string') return payload.callId;
			return typeof payload?.toolCallId === 'string'
				? payload.toolCallId
				: null;
		};

		const getToolEventName = (
			payload: Record<string, unknown> | undefined,
		): string | null => {
			if (typeof payload?.name === 'string') return payload.name;
			return typeof payload?.toolName === 'string' ? payload.toolName : null;
		};

		const getToolEventArgs = (
			payload: Record<string, unknown> | undefined,
		): unknown => payload?.args ?? payload?.input;

		const getToolBufferKey = (
			payload: Record<string, unknown> | undefined,
		): string | null => {
			const callId = getToolEventCallId(payload);
			if (callId) return callId;
			const name = getToolEventName(payload);
			return name ? `name:${name}` : null;
		};

		const parseArgsRecord = (
			value: unknown,
		): Record<string, unknown> | null => {
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				return value as Record<string, unknown>;
			}

			if (typeof value !== 'string') return null;

			try {
				const parsed = JSON.parse(value);
				return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
					? (parsed as Record<string, unknown>)
					: null;
			} catch {
				return null;
			}
		};

		const normalizeLineNumber = (value: unknown): number | undefined => {
			const parsed =
				typeof value === 'number'
					? value
					: typeof value === 'string'
						? Number.parseInt(value, 10)
						: Number.NaN;
			return Number.isFinite(parsed) && parsed > 0
				? Math.floor(parsed)
				: undefined;
		};

		const parseLineRange = (
			value: unknown,
		): { startLine?: number; endLine?: number } => {
			if (typeof value !== 'string') return {};
			const match = value.match(/@(\d+)(?:-(\d+))?/);
			if (!match) return {};
			return {
				startLine: normalizeLineNumber(match[1]),
				endLine: normalizeLineNumber(match[2] ?? match[1]),
			};
		};

		const getBoundedStreamingToolInput = (value: string): string => {
			const maxLength =
				STREAMING_TOOL_INPUT_HEAD_CHARS + STREAMING_TOOL_INPUT_TAIL_CHARS;
			if (value.length <= maxLength) return value;
			return `${value.slice(
				0,
				STREAMING_TOOL_INPUT_HEAD_CHARS,
			)}\n… streamed tool input truncated for UI responsiveness …\n${value.slice(
				-STREAMING_TOOL_INPUT_TAIL_CHARS,
			)}`;
		};

		const getToolArgsForViewer = (
			payload: Record<string, unknown> | undefined,
			delta?: string | null,
		): Record<string, unknown> | null => {
			const args = parseArgsRecord(getToolEventArgs(payload));
			if (args) return args;

			const key = getToolBufferKey(payload);
			if (!key) return null;

			const previous = toolInputBuffersRef.current.get(key) ?? '';
			if (!delta) return parseArgsRecord(previous);

			const next = getBoundedStreamingToolInput(`${previous}${delta}`);
			toolInputBuffersRef.current.set(key, next);
			return parseArgsRecord(next);
		};

		const bestEffortUnescapeJsonString = (value: string): string => {
			try {
				return JSON.parse(`"${value.replace(/\\$/, '')}"`) as string;
			} catch {
				return value
					.replace(/\\n/g, '\n')
					.replace(/\\t/g, '\t')
					.replace(/\\r/g, '\r')
					.replace(/\\"/g, '"')
					.replace(/\\\\/g, '\\');
			}
		};

		const extractJsonStringField = (
			text: string,
			field: string,
			requireClosed = false,
		): string | undefined => {
			const marker = `"${field}"`;
			const markerIndex = text.indexOf(marker);
			if (markerIndex === -1) return undefined;

			const colonIndex = text.indexOf(':', markerIndex + marker.length);
			if (colonIndex === -1) return undefined;

			const quoteIndex = text.indexOf('"', colonIndex + 1);
			if (quoteIndex === -1) return undefined;

			let escaped = '';
			let escaping = false;
			let closed = false;
			for (let i = quoteIndex + 1; i < text.length; i += 1) {
				const char = text[i];
				if (escaping) {
					escaped += `\\${char}`;
					escaping = false;
					continue;
				}

				if (char === '\\') {
					escaping = true;
					continue;
				}

				if (char === '"') {
					closed = true;
					break;
				}
				escaped += char;
			}

			if (requireClosed && !closed) return undefined;

			return bestEffortUnescapeJsonString(escaped);
		};

		const getBufferedToolInput = (
			payload: Record<string, unknown> | undefined,
		): string => {
			const key = getToolBufferKey(payload);
			return key ? (toolInputBuffersRef.current.get(key) ?? '') : '';
		};

		const getStringArg = (
			args: Record<string, unknown> | null,
			buffer: string,
			field: string,
			requireClosed = false,
		): string | undefined => {
			const value = args?.[field];
			if (typeof value === 'string') return value;
			return extractJsonStringField(buffer, field, requireClosed);
		};

		const getStreamingWritePreviewContent = (
			args: Record<string, unknown> | null,
			buffer: string,
		): string | undefined => {
			const argContent = args?.content;
			if (typeof argContent === 'string') {
				if (argContent.length <= STREAMING_WRITE_CONTENT_PREVIEW_CHARS) {
					return argContent;
				}

				return `… showing latest streamed content only …\n${argContent.slice(
					-STREAMING_WRITE_CONTENT_PREVIEW_CHARS,
				)}`;
			}

			const marker = '"content"';
			const markerIndex = buffer.indexOf(marker);
			if (markerIndex === -1) return undefined;

			const colonIndex = buffer.indexOf(':', markerIndex + marker.length);
			if (colonIndex === -1) return undefined;

			const quoteIndex = buffer.indexOf('"', colonIndex + 1);
			if (quoteIndex === -1) return undefined;

			const valueStart = quoteIndex + 1;
			if (buffer.length - valueStart <= STREAMING_WRITE_CONTENT_PREVIEW_CHARS) {
				return extractJsonStringField(buffer, 'content');
			}

			const rawTail = buffer.slice(
				Math.max(
					valueStart,
					buffer.length - STREAMING_WRITE_CONTENT_PREVIEW_CHARS,
				),
			);
			return `… showing latest streamed content only …\n${bestEffortUnescapeJsonString(
				rawTail,
			)}`;
		};

		const getStreamingPatchPreviewContent = (
			args: Record<string, unknown> | null,
			buffer: string,
		): string | undefined => {
			const argPatch = args?.patch;
			if (typeof argPatch === 'string') {
				if (
					argPatch.length <=
					STREAMING_PATCH_PREVIEW_HEAD_CHARS +
						STREAMING_PATCH_PREVIEW_TAIL_CHARS
				) {
					return argPatch;
				}

				return `${argPatch.slice(
					0,
					STREAMING_PATCH_PREVIEW_HEAD_CHARS,
				)}\n… patch preview truncated while streaming …\n${argPatch.slice(
					-STREAMING_PATCH_PREVIEW_TAIL_CHARS,
				)}`;
			}

			const marker = '"patch"';
			const markerIndex = buffer.indexOf(marker);
			if (markerIndex === -1) return undefined;

			const colonIndex = buffer.indexOf(':', markerIndex + marker.length);
			if (colonIndex === -1) return undefined;

			const quoteIndex = buffer.indexOf('"', colonIndex + 1);
			if (quoteIndex === -1) return undefined;

			const valueStart = quoteIndex + 1;
			const rawLength = buffer.length - valueStart;
			if (
				rawLength <=
				STREAMING_PATCH_PREVIEW_HEAD_CHARS + STREAMING_PATCH_PREVIEW_TAIL_CHARS
			) {
				return extractJsonStringField(buffer, 'patch');
			}

			const rawHead = buffer.slice(
				valueStart,
				valueStart + STREAMING_PATCH_PREVIEW_HEAD_CHARS,
			);
			const rawTail = buffer.slice(-STREAMING_PATCH_PREVIEW_TAIL_CHARS);
			return `${bestEffortUnescapeJsonString(
				rawHead,
			)}\n… patch preview truncated while streaming …\n${bestEffortUnescapeJsonString(
				rawTail,
			)}`;
		};

		const getResultRecord = (
			payload: Record<string, unknown> | undefined,
		): Record<string, unknown> | null =>
			payload?.result &&
			typeof payload.result === 'object' &&
			!Array.isArray(payload.result)
				? (payload.result as Record<string, unknown>)
				: null;

		const getArtifactRecord = (
			payload: Record<string, unknown> | undefined,
		): Record<string, unknown> | null =>
			payload?.artifact &&
			typeof payload.artifact === 'object' &&
			!Array.isArray(payload.artifact)
				? (payload.artifact as Record<string, unknown>)
				: null;

		const extractErrorMessage = (
			payload: Record<string, unknown> | undefined,
		): string | undefined => {
			const result = getResultRecord(payload);
			if (typeof payload?.error === 'string') return payload.error;
			return typeof result?.error === 'string' ? result.error : undefined;
		};

		const normalizePatchPath = (path: string): string =>
			path.replace(/^a\//, '').replace(/^b\//, '').trim();

		const patchPathMatches = (
			patchPath: string,
			targetPath: string,
		): boolean => {
			const normalizedPatch = normalizePatchPath(patchPath);
			const normalizedTarget = normalizePatchPath(targetPath);
			return (
				normalizedPatch === normalizedTarget ||
				normalizedPatch.endsWith(`/${normalizedTarget}`) ||
				normalizedTarget.endsWith(`/${normalizedPatch}`)
			);
		};

		const extractPathsFromPatch = (patch: string): string[] => {
			const paths = new Set<string>();
			for (const line of patch.split('\n')) {
				const directive = line.match(
					/^\*\*\* (?:Update|Add|Delete) File: (.+)$/,
				);
				if (directive?.[1]) {
					paths.add(directive[1].trim());
					continue;
				}

				const unified = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
				if (unified?.[1] && unified[1] !== '/dev/null') {
					paths.add(unified[1].trim());
				}
			}

			return [...paths];
		};

		const getChangedLinesForPath = (
			result: Record<string, unknown> | null,
			path: string,
		): number[] | undefined => {
			const changes = Array.isArray(result?.changes) ? result.changes : [];
			const lines = new Set<number>();

			for (const change of changes) {
				if (!change || typeof change !== 'object') continue;
				const record = change as Record<string, unknown>;
				if (typeof record.filePath !== 'string') continue;
				if (!patchPathMatches(record.filePath, path)) continue;
				if (!Array.isArray(record.hunks)) continue;

				for (const hunk of record.hunks) {
					if (!hunk || typeof hunk !== 'object') continue;
					const hunkRecord = hunk as Record<string, unknown>;
					const newStart =
						typeof hunkRecord.newStart === 'number'
							? hunkRecord.newStart
							: undefined;
					const newLines =
						typeof hunkRecord.newLines === 'number'
							? hunkRecord.newLines
							: undefined;
					if (!newStart || !newLines) continue;

					for (let line = newStart; line < newStart + newLines; line += 1) {
						lines.add(line);
					}
				}
			}

			return lines.size > 0 ? [...lines] : undefined;
		};

		const handleReadToolActivity = (
			eventType: string,
			payload: Record<string, unknown> | undefined,
			delta?: string | null,
		) => {
			const viewerStore = useViewerTabsStore.getState();
			if (!viewerStore.followToolActivity) return;

			const name = getToolEventName(payload);
			if (name !== 'read') return;

			const args = getToolArgsForViewer(payload, delta);
			const path = typeof args?.path === 'string' ? args.path : null;
			if (!path) return;

			const result =
				payload?.result &&
				typeof payload.result === 'object' &&
				!Array.isArray(payload.result)
					? (payload.result as Record<string, unknown>)
					: null;
			const rangeFromResult = parseLineRange(result?.lineRange);
			const startLine =
				normalizeLineNumber(args.startLine) ??
				normalizeLineNumber(args.start_line) ??
				rangeFromResult.startLine;
			const endLine =
				normalizeLineNumber(args.endLine) ??
				normalizeLineNumber(args.end_line) ??
				rangeFromResult.endLine ??
				startLine;
			const failed = result?.ok === false || eventType === 'error';

			viewerStore.openToolReadTab(path, {
				startLine,
				endLine,
				reason: 'read',
				callId: getToolEventCallId(payload) ?? undefined,
				status: failed
					? 'error'
					: eventType === 'tool.result'
						? 'success'
						: 'streaming',
			});
		};

		const handleWriteToolActivity = (
			eventType: string,
			payload: Record<string, unknown> | undefined,
			delta?: string | null,
		) => {
			const viewerStore = useViewerTabsStore.getState();
			if (!viewerStore.followToolActivity) return;

			const name = getToolEventName(payload);
			if (name !== 'write') return;

			const args = getToolArgsForViewer(payload, delta);
			const buffer = getBufferedToolInput(payload);
			const result = getResultRecord(payload);
			const path =
				(typeof result?.path === 'string' ? result.path : undefined) ??
				getStringArg(args, buffer, 'path', true);
			if (!path) return;

			const failed = result?.ok === false || eventType === 'error';
			const callId = getToolEventCallId(payload) ?? undefined;
			const status = failed
				? 'error'
				: eventType === 'tool.result'
					? 'success'
					: 'streaming';
			const content =
				status === 'streaming'
					? getStreamingWritePreviewContent(args, buffer)
					: getStringArg(args, buffer, 'content');

			if (
				status === 'streaming' &&
				content !== undefined &&
				content.length >= TOOL_PREVIEW_THROTTLE_MIN_CHARS
			) {
				const previewKey = callId ?? path;
				const now = Date.now();
				const last = toolPreviewEmitRef.current.get(previewKey);
				const contentDelta = Math.abs(
					content.length - (last?.contentLength ?? 0),
				);
				if (
					last &&
					now - last.emittedAt < TOOL_PREVIEW_THROTTLE_MS &&
					contentDelta < TOOL_PREVIEW_THROTTLE_MIN_DELTA_CHARS
				) {
					return;
				}

				toolPreviewEmitRef.current.set(previewKey, {
					emittedAt: now,
					contentLength: content.length,
				});
			}

			viewerStore.openToolPreviewTab({
				path,
				toolName: 'write',
				callId,
				content,
				status,
				error: extractErrorMessage(payload),
			});
		};

		const handleApplyPatchToolActivity = (
			eventType: string,
			payload: Record<string, unknown> | undefined,
			delta?: string | null,
		) => {
			const viewerStore = useViewerTabsStore.getState();
			if (!viewerStore.followToolActivity) return;

			const name = getToolEventName(payload);
			if (name !== 'apply_patch') return;

			const args = getToolArgsForViewer(payload, delta);
			const buffer = getBufferedToolInput(payload);
			const artifact = getArtifactRecord(payload);
			const result = getResultRecord(payload);
			const failed = result?.ok === false || eventType === 'error';
			const status = failed
				? 'error'
				: eventType === 'tool.result'
					? 'success'
					: 'streaming';
			const callId = getToolEventCallId(payload) ?? undefined;

			if (
				status === 'streaming' &&
				buffer.length >= TOOL_PREVIEW_THROTTLE_MIN_CHARS
			) {
				const previewKey = callId ?? 'apply_patch';
				const now = Date.now();
				const last = toolPreviewEmitRef.current.get(previewKey);
				const contentDelta = Math.abs(
					buffer.length - (last?.contentLength ?? 0),
				);
				if (
					last &&
					now - last.emittedAt < TOOL_PREVIEW_THROTTLE_MS &&
					contentDelta < TOOL_PREVIEW_THROTTLE_MIN_DELTA_CHARS
				) {
					return;
				}

				toolPreviewEmitRef.current.set(previewKey, {
					emittedAt: now,
					contentLength: buffer.length,
				});
			}

			const patch =
				(typeof artifact?.patch === 'string' ? artifact.patch : undefined) ??
				(status === 'streaming'
					? getStreamingPatchPreviewContent(args, buffer)
					: getStringArg(args, buffer, 'patch'));
			if (!patch) return;

			for (const path of extractPathsFromPatch(patch)) {
				viewerStore.openToolPreviewTab({
					path,
					toolName: 'apply_patch',
					callId,
					patch,
					changedLines: getChangedLinesForPath(result, path),
					status,
					error: extractErrorMessage(payload),
				});
			}
		};

		const handleToolActivityViewerEvent = (
			eventType: string,
			payload: Record<string, unknown> | undefined,
			delta?: string | null,
		) => {
			const name = getToolEventName(payload);
			if (name === 'read') handleReadToolActivity(eventType, payload, delta);
			if (name === 'write') handleWriteToolActivity(eventType, payload, delta);
			if (name === 'apply_patch') {
				handleApplyPatchToolActivity(eventType, payload, delta);
			}
		};

		const getToolInputDelta = (
			payload: Record<string, unknown> | undefined,
		): string | null => {
			if (typeof payload?.delta === 'string') return payload.delta;
			return typeof payload?.inputTextDelta === 'string'
				? payload.inputTextDelta
				: null;
		};

		const getToolOutputDelta = (
			payload: Record<string, unknown> | undefined,
		): string | null => {
			if (typeof payload?.delta === 'string') return payload.delta;
			return typeof payload?.outputTextDelta === 'string'
				? payload.outputTextDelta
				: null;
		};

		const getOptimisticPartIndex = (
			parts: MessagePart[],
			_stepIndex: number | null,
		): number => {
			const indexes = parts
				.map((part) => part.index)
				.filter((index): index is number => Number.isFinite(index));
			return indexes.length > 0 ? Math.max(...indexes) + 0.001 : 0;
		};

		const applyReasoningDelta = (
			payload: Record<string, unknown> | undefined,
		) => {
			const messageId =
				typeof payload?.messageId === 'string' ? payload.messageId : null;
			const partId =
				typeof payload?.partId === 'string' ? payload.partId : null;
			const delta = typeof payload?.delta === 'string' ? payload.delta : null;
			if (!messageId || !partId || delta === null) return;
			queryClient.setQueryData<Message[]>(
				['messages', sessionId],
				(oldMessages) => {
					if (!oldMessages) return oldMessages;
					const nextMessages = [...oldMessages];
					const messageIndex = nextMessages.findIndex(
						(message) => message.id === messageId,
					);
					if (messageIndex === -1) return oldMessages;
					const targetMessage = nextMessages[messageIndex];
					const parts = targetMessage.parts ? [...targetMessage.parts] : [];
					let partIndex = parts.findIndex((part) => part.id === partId);
					const stepIndex =
						typeof payload?.stepIndex === 'number' ? payload.stepIndex : null;
					if (partIndex === -1) {
						const newPart: MessagePart = {
							id: partId,
							messageId,
							index: getOptimisticPartIndex(parts, stepIndex),
							stepIndex,
							type: 'reasoning',
							content: JSON.stringify({ text: delta }),
							contentJson: { text: delta },
							agent: targetMessage.agent,
							provider: targetMessage.provider,
							model: targetMessage.model,
							startedAt: Date.now(),
							completedAt: null,
							toolName: null,
							toolCallId: null,
							toolDurationMs: null,
						};
						parts.push(newPart);
						partIndex = parts.length - 1;
					} else {
						const existing = parts[partIndex];
						const previous = extractText(existing);
						const nextText = `${previous}${delta}`;
						parts[partIndex] = {
							...existing,
							content: JSON.stringify({ text: nextText }),
							contentJson: { text: nextText },
							stepIndex: stepIndex ?? existing.stepIndex ?? null,
							completedAt: null,
						};
					}
					nextMessages[messageIndex] = { ...targetMessage, parts };
					return nextMessages;
				},
			);
		};

		const applyMessageDelta = (
			payload: Record<string, unknown> | undefined,
		) => {
			const messageId =
				typeof payload?.messageId === 'string' ? payload.messageId : null;
			const partId =
				typeof payload?.partId === 'string' ? payload.partId : null;
			const delta = typeof payload?.delta === 'string' ? payload.delta : null;
			if (!messageId || !partId || delta === null) return;
			queryClient.setQueryData<Message[]>(
				['messages', sessionId],
				(oldMessages) => {
					if (!oldMessages) return oldMessages;
					const nextMessages = [...oldMessages];
					const messageIndex = nextMessages.findIndex(
						(message) => message.id === messageId,
					);
					if (messageIndex === -1) return oldMessages;
					const targetMessage = nextMessages[messageIndex];
					const parts = targetMessage.parts ? [...targetMessage.parts] : [];
					let partIndex = parts.findIndex((part) => part.id === partId);
					const stepIndex =
						typeof payload?.stepIndex === 'number' ? payload.stepIndex : null;
					if (partIndex === -1) {
						const newPart: MessagePart = {
							id: partId,
							messageId,
							index: getOptimisticPartIndex(parts, stepIndex),
							stepIndex,
							type: 'text',
							content: JSON.stringify({ text: delta }),
							contentJson: { text: delta },
							agent: targetMessage.agent,
							provider: targetMessage.provider,
							model: targetMessage.model,
							startedAt: Date.now(),
							completedAt: null,
							toolName: null,
							toolCallId: null,
							toolDurationMs: null,
						};
						parts.push(newPart);
						partIndex = parts.length - 1;
					} else {
						const existing = parts[partIndex];
						const previous = extractText(existing);
						const nextText = `${previous}${delta}`;
						parts[partIndex] = {
							...existing,
							content: JSON.stringify({ text: nextText }),
							contentJson: { text: nextText },
							stepIndex: stepIndex ?? existing.stepIndex ?? null,
							completedAt: null,
						};
					}
					nextMessages[messageIndex] = { ...targetMessage, parts };
					return nextMessages;
				},
			);
		};

		const upsertEphemeralToolCall = (
			payload: Record<string, unknown> | undefined,
		) => {
			if (!payload) return;
			const callId = getToolEventCallId(payload);
			const name = getToolEventName(payload);
			if (!name) return;

			if (name === 'write' || name === 'apply_patch') {
				const bufferKey = getToolBufferKey(payload);
				const bufferedLength = bufferKey
					? (toolInputBuffersRef.current.get(bufferKey)?.length ?? 0)
					: 0;
				if (bufferedLength >= TOOL_PREVIEW_THROTTLE_MIN_CHARS) {
					const emitKey = callId ?? `name:${name}`;
					const now = Date.now();
					const last = toolMessageEmitRef.current.get(emitKey) ?? 0;
					if (now - last < STREAMING_TOOL_MESSAGE_THROTTLE_MS) return;
					toolMessageEmitRef.current.set(emitKey, now);
				}
			}

			queryClient.setQueryData<Message[]>(
				['messages', sessionId],
				(oldMessages) => {
					if (!oldMessages) return oldMessages;
					const nextMessages = [...oldMessages];
					let targetIndex = resolveAssistantTargetIndex(nextMessages);
					if (typeof payload.messageId === 'string') {
						const explicitIndex = nextMessages.findIndex(
							(message) => message.id === payload.messageId,
						);
						if (explicitIndex !== -1) targetIndex = explicitIndex;
					}
					if (targetIndex === -1) return oldMessages;
					const targetMessage = nextMessages[targetIndex];
					const parts = targetMessage.parts ? [...targetMessage.parts] : [];
					let partIndex = -1;
					if (callId) {
						partIndex = parts.findIndex(
							(part) => part.toolCallId === callId && part.ephemeral,
						);
					}
					// Only fallback to name match if we don't have a callId
					if (partIndex === -1 && !callId) {
						partIndex = parts.findIndex(
							(part) => part.ephemeral && part.toolName === name,
						);
					}
					const args = getToolEventArgs(payload);
					const stepIndex =
						typeof payload.stepIndex === 'number' ? payload.stepIndex : null;
					const contentJsonBase: Record<string, unknown> = { name };
					if (callId) contentJsonBase.callId = callId;
					if (args !== undefined) contentJsonBase.args = args;
					if (partIndex === -1) {
						const newPart: MessagePart = {
							id: callId
								? `ephemeral-tool-call-${callId}`
								: `ephemeral-tool-call-${name}-${Date.now()}`,
							messageId: targetMessage.id,
							index: getOptimisticPartIndex(parts, stepIndex),
							stepIndex,
							type: 'tool_call',
							content: JSON.stringify(contentJsonBase),
							contentJson: contentJsonBase,
							agent: targetMessage.agent,
							provider: targetMessage.provider,
							model: targetMessage.model,
							startedAt: Date.now(),
							completedAt: null,
							toolName: name,
							toolCallId: callId,
							toolDurationMs: null,
							ephemeral: true,
						};
						parts.push(newPart);
					} else {
						const existing = parts[partIndex];
						const nextContentJson: Record<string, unknown> = {
							...(typeof existing.contentJson === 'object' &&
							!Array.isArray(existing.contentJson)
								? (existing.contentJson as Record<string, unknown>)
								: {}),
							name,
						};
						if (callId) nextContentJson.callId = callId;
						if (args !== undefined) nextContentJson.args = args;
						parts[partIndex] = {
							...existing,
							content: JSON.stringify(nextContentJson),
							contentJson: nextContentJson,
							stepIndex: stepIndex ?? existing.stepIndex ?? null,
							toolCallId: callId ?? existing.toolCallId,
							toolName: name,
						};
					}
					nextMessages[targetIndex] = { ...targetMessage, parts };
					return nextMessages;
				},
			);
		};

		const accumulateToolInputDelta = (
			payload: Record<string, unknown> | undefined,
			delta: string,
		) => {
			if (!payload) return;
			const callId = getToolEventCallId(payload);
			const name = getToolEventName(payload);
			if (!name) return;
			queryClient.setQueryData<Message[]>(
				['messages', sessionId],
				(oldMessages) => {
					if (!oldMessages) return oldMessages;
					const nextMessages = [...oldMessages];
					let targetIndex = resolveAssistantTargetIndex(nextMessages);
					if (typeof payload.messageId === 'string') {
						const explicitIndex = nextMessages.findIndex(
							(message) => message.id === payload.messageId,
						);
						if (explicitIndex !== -1) targetIndex = explicitIndex;
					}
					if (targetIndex === -1) return oldMessages;
					const targetMessage = nextMessages[targetIndex];
					const parts = targetMessage.parts ? [...targetMessage.parts] : [];
					let partIndex = -1;
					if (callId) {
						partIndex = parts.findIndex(
							(part) => part.toolCallId === callId && part.ephemeral,
						);
					}
					if (partIndex === -1 && !callId) {
						partIndex = parts.findIndex(
							(part) => part.ephemeral && part.toolName === name,
						);
					}
					const stepIndex =
						typeof payload.stepIndex === 'number' ? payload.stepIndex : null;
					if (partIndex === -1) {
						const contentJsonBase: Record<string, unknown> = {
							name,
							_streamedInput: getBoundedStreamingToolInput(delta),
						};
						if (callId) contentJsonBase.callId = callId;
						const newPart: MessagePart = {
							id: callId
								? `ephemeral-tool-call-${callId}`
								: `ephemeral-tool-call-${name}-${Date.now()}`,
							messageId: targetMessage.id,
							index: getOptimisticPartIndex(parts, stepIndex),
							stepIndex,
							type: 'tool_call',
							content: JSON.stringify(contentJsonBase),
							contentJson: contentJsonBase,
							agent: targetMessage.agent,
							provider: targetMessage.provider,
							model: targetMessage.model,
							startedAt: Date.now(),
							completedAt: null,
							toolName: name,
							toolCallId: callId,
							toolDurationMs: null,
							ephemeral: true,
						};
						parts.push(newPart);
					} else {
						const existing = parts[partIndex];
						const prev =
							typeof (existing.contentJson as Record<string, unknown>)
								?._streamedInput === 'string'
								? ((existing.contentJson as Record<string, unknown>)
										._streamedInput as string)
								: '';
						const nextContentJson: Record<string, unknown> = {
							...(typeof existing.contentJson === 'object' &&
							!Array.isArray(existing.contentJson)
								? (existing.contentJson as Record<string, unknown>)
								: {}),
							_streamedInput: getBoundedStreamingToolInput(prev + delta),
						};
						parts[partIndex] = {
							...existing,
							content: JSON.stringify(nextContentJson),
							contentJson: nextContentJson,
							stepIndex: stepIndex ?? existing.stepIndex ?? null,
						};
					}
					nextMessages[targetIndex] = { ...targetMessage, parts };
					return nextMessages;
				},
			);
		};

		const accumulateToolOutputDelta = (
			payload: Record<string, unknown> | undefined,
			delta: string,
		) => {
			if (!payload) return;
			const callId = getToolEventCallId(payload);
			const name = getToolEventName(payload);
			if (!name) return;
			queryClient.setQueryData<Message[]>(
				['messages', sessionId],
				(oldMessages) => {
					if (!oldMessages) return oldMessages;
					const nextMessages = [...oldMessages];
					let targetIndex = resolveAssistantTargetIndex(nextMessages);
					if (typeof payload.messageId === 'string') {
						const explicitIndex = nextMessages.findIndex(
							(message) => message.id === payload.messageId,
						);
						if (explicitIndex !== -1) targetIndex = explicitIndex;
					}
					if (targetIndex === -1) return oldMessages;
					const targetMessage = nextMessages[targetIndex];
					const parts = targetMessage.parts ? [...targetMessage.parts] : [];
					let partIndex = -1;
					if (callId) {
						partIndex = parts.findIndex(
							(part) => part.toolCallId === callId && part.ephemeral,
						);
					}
					if (partIndex === -1 && !callId) {
						partIndex = parts.findIndex(
							(part) => part.ephemeral && part.toolName === name,
						);
					}
					const stepIndex =
						typeof payload.stepIndex === 'number' ? payload.stepIndex : null;
					if (partIndex === -1) {
						const contentJsonBase: Record<string, unknown> = {
							name,
							_streamedOutput: delta,
						};
						if (callId) contentJsonBase.callId = callId;
						const newPart: MessagePart = {
							id: callId
								? `ephemeral-tool-call-${callId}`
								: `ephemeral-tool-call-${name}-${Date.now()}`,
							messageId: targetMessage.id,
							index: getOptimisticPartIndex(parts, stepIndex),
							stepIndex,
							type: 'tool_call',
							content: JSON.stringify(contentJsonBase),
							contentJson: contentJsonBase,
							agent: targetMessage.agent,
							provider: targetMessage.provider,
							model: targetMessage.model,
							startedAt: Date.now(),
							completedAt: null,
							toolName: name,
							toolCallId: callId,
							toolDurationMs: null,
							ephemeral: true,
						};
						parts.push(newPart);
					} else {
						const existing = parts[partIndex];
						const prev =
							typeof (existing.contentJson as Record<string, unknown>)
								?._streamedOutput === 'string'
								? ((existing.contentJson as Record<string, unknown>)
										._streamedOutput as string)
								: '';
						const nextContentJson: Record<string, unknown> = {
							...(typeof existing.contentJson === 'object' &&
							!Array.isArray(existing.contentJson)
								? (existing.contentJson as Record<string, unknown>)
								: {}),
							_streamedOutput: prev + delta,
						};
						parts[partIndex] = {
							...existing,
							content: JSON.stringify(nextContentJson),
							contentJson: nextContentJson,
							stepIndex: stepIndex ?? existing.stepIndex ?? null,
						};
					}
					nextMessages[targetIndex] = { ...targetMessage, parts };
					return nextMessages;
				},
			);
		};

		const resolveEphemeralToolCall = (
			payload: Record<string, unknown> | undefined,
		) => {
			const callId = getToolEventCallId(payload);
			if (!callId) return;
			const payloadName = getToolEventName(payload);
			const payloadStepIndex =
				typeof payload?.stepIndex === 'number' ? payload.stepIndex : null;
			const payloadResult = payload?.result;
			const payloadArtifact = payload?.artifact;
			const payloadArgs = getToolEventArgs(payload);
			queryClient.setQueryData<Message[]>(
				['messages', sessionId],
				(oldMessages) => {
					if (!oldMessages) return oldMessages;
					let changed = false;
					const now = Date.now();
					const nextMessages = oldMessages.map((message) => {
						if (!message.parts?.length) return message;
						let messageChanged = false;
						const updatedParts = message.parts.map((part) => {
							if (!(part.ephemeral && part.toolCallId === callId)) {
								return part;
							}
							messageChanged = true;
							changed = true;
							const nextContentJson: Record<string, unknown> = {
								...(typeof part.contentJson === 'object' &&
								!Array.isArray(part.contentJson)
									? (part.contentJson as Record<string, unknown>)
									: {}),
								name: payloadName ?? part.toolName ?? 'tool',
								callId,
							};
							if (payloadArgs !== undefined) nextContentJson.args = payloadArgs;
							if (payloadResult !== undefined)
								nextContentJson.result = payloadResult;
							if (payloadArtifact !== undefined)
								nextContentJson.artifact = payloadArtifact;
							const durationMs =
								part.startedAt && Number.isFinite(part.startedAt)
									? Math.max(0, now - part.startedAt)
									: part.toolDurationMs;
							const resolvedPart: MessagePart = {
								...part,
								type: 'tool_result',
								content: JSON.stringify(nextContentJson),
								contentJson: nextContentJson,
								stepIndex: payloadStepIndex ?? part.stepIndex ?? null,
								completedAt: now,
								toolName: payloadName ?? part.toolName,
								toolDurationMs: durationMs ?? null,
							};
							return resolvedPart;
						});
						if (!messageChanged) return message;
						return { ...message, parts: updatedParts };
					});
					return changed ? nextMessages : oldMessages;
				},
			);
		};

		const removeEphemeralToolCall = (
			payload: Record<string, unknown> | undefined,
		) => {
			const callId = getToolEventCallId(payload);
			if (!callId) return;
			queryClient.setQueryData<Message[]>(
				['messages', sessionId],
				(oldMessages) => {
					if (!oldMessages) return oldMessages;
					let changed = false;
					const nextMessages = oldMessages.map((message) => {
						if (!message.parts?.length) return message;
						const filtered = message.parts.filter(
							(part) => !(part.ephemeral && part.toolCallId === callId),
						);
						if (filtered.length === message.parts.length) return message;
						changed = true;
						return { ...message, parts: filtered };
					});
					return changed ? nextMessages : oldMessages;
				},
			);
		};

		const clearEphemeralForMessage = (messageId: string | null) => {
			if (!messageId) return;
			queryClient.setQueryData<Message[]>(
				['messages', sessionId],
				(oldMessages) => {
					if (!oldMessages) return oldMessages;
					const targetIndex = oldMessages.findIndex(
						(message) => message.id === messageId,
					);
					if (targetIndex === -1) return oldMessages;
					const target = oldMessages[targetIndex];
					if (
						!target.parts?.some(
							(part) => part.ephemeral && part.type === 'tool_call',
						)
					)
						return oldMessages;
					const nextMessages = [...oldMessages];
					nextMessages[targetIndex] = {
						...target,
						parts:
							target.parts?.filter(
								(part) => !(part.ephemeral && part.type === 'tool_call'),
							) ?? [],
					};
					return nextMessages;
				},
			);
		};

		const markMessageCompleted = (
			payload: Record<string, unknown> | undefined,
		) => {
			const id = typeof payload?.id === 'string' ? payload.id : null;
			if (!id) return;
			queryClient.setQueryData<Message[]>(
				['messages', sessionId],
				(oldMessages) => {
					if (!oldMessages) return oldMessages;
					const nextMessages = [...oldMessages];
					const messageIndex = nextMessages.findIndex(
						(message) => message.id === id,
					);
					if (messageIndex === -1) return oldMessages;
					const existing = nextMessages[messageIndex];
					nextMessages[messageIndex] = {
						...existing,
						status: 'complete',
						completedAt: Date.now(),
					};
					return nextMessages;
				},
			);
		};

		const unsubscribe = client.on('*', (event) => {
			// console.log('[useSessionStream] Event received:', event);
			const payload = event.payload as Record<string, unknown> | undefined;

			switch (event.type) {
				case 'message.created': {
					const role = typeof payload?.role === 'string' ? payload.role : null;
					const id = typeof payload?.id === 'string' ? payload.id : null;
					if (role === 'assistant' && id) {
						assistantMessageIdRef.current = id;
					}
					if (id && role) {
						const agent =
							typeof payload?.agent === 'string' ? payload.agent : '';
						const provider =
							typeof payload?.provider === 'string' ? payload.provider : '';
						const model =
							typeof payload?.model === 'string' ? payload.model : '';
						const content =
							typeof payload?.content === 'string' ? payload.content : null;
						const userParts: MessagePart[] =
							role === 'user' && content
								? [
										{
											id: `${id}-text`,
											messageId: id,
											index: 0,
											stepIndex: null,
											type: 'text',
											content: JSON.stringify({ text: content }),
											contentJson: { text: content },
											agent,
											provider,
											model,
											startedAt: Date.now(),
											completedAt: Date.now(),
											toolName: null,
											toolCallId: null,
											toolDurationMs: null,
										},
									]
								: [];
						queryClient.setQueryData<Message[]>(
							['messages', sessionId],
							(oldMessages) => {
								if (!oldMessages) return oldMessages;
								if (oldMessages.some((m) => m.id === id)) return oldMessages;
								const newMessage: Message = {
									id,
									sessionId,
									role: role as Message['role'],
									status: role === 'user' ? 'complete' : 'pending',
									agent,
									provider,
									model,
									createdAt: Date.now(),
									completedAt: null,
									latencyMs: null,
									promptTokens: null,
									completionTokens: null,
									totalTokens: null,
									error: null,
									parts: userParts,
								};
								const next = [...oldMessages, newMessage];
								next.sort((a, b) => a.createdAt - b.createdAt);
								return next;
							},
						);
					}
					break;
				}
				case 'message.part.delta': {
					applyMessageDelta(payload);
					break;
				}
				case 'reasoning.delta': {
					applyReasoningDelta(payload);
					break;
				}
				case 'message.completed': {
					const id = typeof payload?.id === 'string' ? payload.id : null;
					if (id && assistantMessageIdRef.current === id) {
						assistantMessageIdRef.current = null;
					}
					markMessageCompleted(payload);
					clearEphemeralForMessage(id);
					queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
					queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
					break;
				}
				case 'tool.delta': {
					const channel =
						typeof payload?.channel === 'string' ? payload.channel : null;
					const delta =
						channel === 'output'
							? getToolOutputDelta(payload)
							: getToolInputDelta(payload);
					if (channel === 'input' || (channel == null && delta)) {
						if (delta) {
							accumulateToolInputDelta(payload, delta);
							handleToolActivityViewerEvent('tool.delta', payload, delta);
						} else {
							upsertEphemeralToolCall(payload);
							handleToolActivityViewerEvent('tool.delta', payload);
						}
					} else if (channel === 'output' && delta) {
						accumulateToolOutputDelta(payload, delta);
					}
					break;
				}
				case 'tool.call': {
					upsertEphemeralToolCall(payload);
					handleToolActivityViewerEvent('tool.call', payload);
					break;
				}
				case 'tool.result': {
					resolveEphemeralToolCall(payload);
					handleToolActivityViewerEvent('tool.result', payload);
					const key = getToolBufferKey(payload);
					if (key) toolInputBuffersRef.current.delete(key);
					break;
				}
				case 'tool.approval.required': {
					const callId =
						typeof payload?.callId === 'string' ? payload.callId : null;
					const toolName =
						typeof payload?.toolName === 'string' ? payload.toolName : null;
					const messageId =
						typeof payload?.messageId === 'string' ? payload.messageId : null;
					const args = payload?.args;
					if (callId && toolName && messageId) {
						addPendingApproval({
							callId,
							toolName,
							args,
							messageId,
							createdAt: Date.now(),
						});
					}
					break;
				}
				case 'tool.approval.resolved': {
					const callId =
						typeof payload?.callId === 'string' ? payload.callId : null;
					if (callId) {
						removePendingApproval(callId);
					}
					break;
				}
				case 'tool.approval.updated': {
					const callId =
						typeof payload?.callId === 'string' ? payload.callId : null;
					const args = payload?.args;
					if (callId) {
						updatePendingApproval(callId, args);
					}
					break;
				}
				case 'error': {
					handleToolActivityViewerEvent('error', payload);
					removeEphemeralToolCall(payload);
					const messageId =
						typeof payload?.messageId === 'string' ? payload.messageId : null;
					if (messageId) {
						if (assistantMessageIdRef.current === messageId) {
							assistantMessageIdRef.current = null;
						}
						clearEphemeralForMessage(messageId);
						const errorMessage =
							typeof payload?.error === 'string'
								? payload.error
								: typeof payload?.message === 'string'
									? payload.message
									: 'Assistant run failed';
						queryClient.setQueryData<Message[]>(
							['messages', sessionId],
							(oldMessages) => {
								if (!oldMessages) return oldMessages;
								const idx = oldMessages.findIndex((m) => m.id === messageId);
								if (idx === -1) return oldMessages;
								const next = [...oldMessages];
								next[idx] = {
									...next[idx],
									status: 'error',
									completedAt: next[idx].completedAt ?? Date.now(),
									error: errorMessage,
								};
								return next;
							},
						);
					}
					queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
					break;
				}
				case 'message.updated': {
					const id = typeof payload?.id === 'string' ? payload.id : null;
					const status =
						typeof payload?.status === 'string' ? payload.status : null;
					if (id && status) {
						if (status !== 'pending' && assistantMessageIdRef.current === id) {
							assistantMessageIdRef.current = null;
						}
						if (status !== 'pending') {
							clearEphemeralForMessage(id);
						}
						const error =
							typeof payload?.error === 'string' ? payload.error : undefined;
						queryClient.setQueryData<Message[]>(
							['messages', sessionId],
							(oldMessages) => {
								if (!oldMessages) return oldMessages;
								const idx = oldMessages.findIndex((m) => m.id === id);
								if (idx === -1) return oldMessages;
								const next = [...oldMessages];
								next[idx] = {
									...next[idx],
									status: status as Message['status'],
									completedAt:
										status === 'pending'
											? next[idx].completedAt
											: (next[idx].completedAt ?? Date.now()),
									error: error ?? next[idx].error,
								};
								return next;
							},
						);
					}
					break;
				}
				case 'queue.updated': {
					const queueState = {
						currentMessageId: payload?.currentMessageId as string | null,
						queuedMessages: (payload?.queuedMessages ?? []) as Array<{
							messageId: string;
							position: number;
						}>,
						queueLength: (payload?.queueLength ?? 0) as number,
					};
					queryClient.setQueryData(['queueState', sessionId], queueState);
					break;
				}
				default:
					break;
			}

			if (event.type === 'finish-step') {
				const now = Date.now();
				if (now - lastSessionInvalidation >= 2000) {
					lastSessionInvalidation = now;
					queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
				}
			}
		});

		return () => {
			unsubscribe();
			client.disconnect();
		};
	}, [
		sessionId,
		queryClient,
		addPendingApproval,
		removePendingApproval,
		enabled,
		setPendingApprovals,
		updatePendingApproval,
	]);
}
