import type { QueryClient } from '@tanstack/react-query';
import { acquireSessionEventStream } from '../lib/event-stream';
import type { Message, MessagePart } from '../types/api';
import type { ShellJob } from '../lib/api-client';
import { useToolApprovalStore } from '../stores/toolApprovalStore';
import { useSecureInputStore } from '../stores/secureInputStore';
import { allowsEmptySecureInput } from '../lib/secure-input-prompt';
import { useViewerTabsStore } from '../stores/viewerTabsStore';
import {
	getQueueStateQueryKey,
	normalizeQueueState,
	queueMessageIdInCache,
} from './useQueueState';
import { getSessionQueryKey, getSessionsQueryKey } from './useSessions';
import {
	getMessagesQueryKey,
	optimisticMessageMatchesText,
	updateMessagesCache,
} from './useMessages';
import { getProjectKey } from '../lib/api-client/utils';
import { extractStreamingMultiEditPreviewEdits } from './tool-preview-helpers';

const TOOL_PREVIEW_THROTTLE_MS = 500;
const TOOL_PREVIEW_THROTTLE_MIN_CHARS = 8_000;
const TOOL_PREVIEW_THROTTLE_MIN_DELTA_CHARS = 16_000;
const STREAMING_WRITE_CONTENT_PREVIEW_CHARS = 24_000;
const STREAMING_PATCH_PREVIEW_HEAD_CHARS = 12_000;
const STREAMING_PATCH_PREVIEW_TAIL_CHARS = 24_000;
const STREAMING_TOOL_INPUT_HEAD_CHARS = 8_000;
const STREAMING_TOOL_INPUT_TAIL_CHARS = 16_000;
const STREAMING_TOOL_MESSAGE_THROTTLE_MS = 500;

export interface SessionStreamEngineOptions {
	sessionId: string;
	queryClient: QueryClient;
	/**
	 * Whether this session currently drives global, single-session UI state
	 * (viewer tabs, tool approvals, secure input prompts). Background engines
	 * keep the query caches fresh without touching that UI.
	 */
	isActive: () => boolean;
}

type ToolApprovalActions = ReturnType<typeof useToolApprovalStore.getState>;
type SecureInputActions = ReturnType<typeof useSecureInputStore.getState>;

/**
 * Applies one session's SSE events to the React Query caches. Hook-free so a
 * stream can stay attached while its session runs in the background and no
 * chunks are lost while the user is viewing another session.
 *
 * Returns a cleanup function that detaches from the shared event stream.
 */
export function startSessionStreamEngine({
	sessionId,
	queryClient,
	isActive,
}: SessionStreamEngineOptions): () => void {
	const assistantMessageIdRef = { current: null as string | null };
	const toolInputBuffersRef = { current: new Map<string, string>() };
	const toolPreviewEmitRef = {
		current: new Map<
			string,
			{ emittedAt: number; contentLength: number; lineSignature?: string }
		>(),
	};
	const toolMessageEmitRef = { current: new Map<string, number>() };
	let lastSessionInvalidation = 0;

	// Query keys are captured once so a background engine keeps writing to the
	// caches of the project it was started for, even if the app switches
	// projects while the engine is still attached.
	const projectKey = getProjectKey();
	const projectScopedKey = <T extends readonly unknown[]>(key: T) =>
		['project', projectKey, ...key] as const;
	const messagesQueryKey = getMessagesQueryKey(sessionId);
	/** Applies a flat-array update to the cursor-paged messages cache. */
	const updateThreadMessages = (
		updater: (messages: Message[]) => Message[],
	) => {
		updateMessagesCache(queryClient, sessionId, updater);
	};
	const queueStateQueryKey = getQueueStateQueryKey(sessionId);
	const sessionQueryKey = getSessionQueryKey(sessionId);
	const sessionsQueryKey = getSessionsQueryKey();

	// Approval and secure-input prompts drive global single-session UI, so
	// only the active session's engine may add them.
	const addPendingApproval: ToolApprovalActions['addPendingApproval'] = (
		approval,
	) => {
		if (!isActive()) return;
		useToolApprovalStore.getState().addPendingApproval(approval);
	};
	const updatePendingApproval: ToolApprovalActions['updatePendingApproval'] = (
		callId,
		args,
	) => {
		useToolApprovalStore.getState().updatePendingApproval(callId, args);
	};
	const removePendingApproval: ToolApprovalActions['removePendingApproval'] = (
		callId,
	) => {
		useToolApprovalStore.getState().removePendingApproval(callId);
	};
	const addPendingInput: SecureInputActions['addPendingInput'] = (input) => {
		if (!isActive()) return;
		useSecureInputStore.getState().addPendingInput(input);
	};
	const removePendingInput: SecureInputActions['removePendingInput'] = (
		promptId,
	) => {
		useSecureInputStore.getState().removePendingInput(promptId);
	};

	const stream = acquireSessionEventStream(sessionId);

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
		return typeof payload?.toolCallId === 'string' ? payload.toolCallId : null;
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

	const getToolEventResult = (
		payload: Record<string, unknown> | undefined,
	): unknown => payload?.result ?? payload?.output;

	const getToolBufferKey = (
		payload: Record<string, unknown> | undefined,
	): string | null => {
		const callId = getToolEventCallId(payload);
		if (callId) return callId;
		const name = getToolEventName(payload);
		return name ? `name:${name}` : null;
	};

	const shellJobsQueryKey = projectScopedKey([
		'shell-jobs',
		sessionId,
	] as const);
	const upsertShellJob = (job: ShellJob) => {
		queryClient.setQueryData<{ jobs: ShellJob[] }>(
			shellJobsQueryKey,
			(current) => ({
				jobs: current?.jobs.some((entry) => entry.id === job.id)
					? current.jobs.map((entry) => (entry.id === job.id ? job : entry))
					: [job, ...(current?.jobs ?? [])],
			}),
		);
	};
	const appendShellJobOutput = (
		jobId: string,
		delta: string,
		updatedAt: number,
	) => {
		queryClient.setQueryData<{ jobs: ShellJob[] }>(
			shellJobsQueryKey,
			(current) => {
				if (!current) return current;
				return {
					jobs: current.jobs.map((job) =>
						job.id === jobId
							? {
									...job,
									output: `${job.output}${delta}`.slice(-1024 * 1024),
									updatedAt,
								}
							: job,
					),
				};
			},
		);
	};

	const parseArgsRecord = (value: unknown): Record<string, unknown> | null => {
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
				STREAMING_PATCH_PREVIEW_HEAD_CHARS + STREAMING_PATCH_PREVIEW_TAIL_CHARS
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
	): Record<string, unknown> | null => {
		if (
			payload?.artifact &&
			typeof payload.artifact === 'object' &&
			!Array.isArray(payload.artifact)
		) {
			return payload.artifact as Record<string, unknown>;
		}

		const result = getResultRecord(payload);
		return result?.artifact &&
			typeof result.artifact === 'object' &&
			!Array.isArray(result.artifact)
			? (result.artifact as Record<string, unknown>)
			: null;
	};

	const extractErrorMessage = (
		payload: Record<string, unknown> | undefined,
	): string | undefined => {
		const result = getResultRecord(payload);
		if (typeof payload?.error === 'string') return payload.error;
		return typeof result?.error === 'string' ? result.error : undefined;
	};

	const normalizePatchPath = (path: string): string =>
		path.replace(/^a\//, '').replace(/^b\//, '').trim();

	const patchPathMatches = (patchPath: string, targetPath: string): boolean => {
		const normalizedPatch = normalizePatchPath(patchPath);
		const normalizedTarget = normalizePatchPath(targetPath);
		return (
			normalizedPatch === normalizedTarget ||
			normalizedPatch.endsWith(`/${normalizedTarget}`) ||
			normalizedTarget.endsWith(`/${normalizedPatch}`)
		);
	};

	const patchPathMayReferToTarget = (
		patchPath: string,
		targetPath: string,
	): boolean => {
		const normalizedPatch = normalizePatchPath(patchPath).replace(/\/+$/, '');
		const normalizedTarget = normalizePatchPath(targetPath);
		if (!normalizedPatch) return false;
		return (
			patchPathMatches(patchPath, targetPath) ||
			normalizedTarget.startsWith(`${normalizedPatch}/`)
		);
	};

	const isLikelyCompletePatchPath = (path: string): boolean => {
		const normalized = normalizePatchPath(path);
		if (!normalized || normalized.endsWith('/')) return false;
		const name = normalized.split('/').pop() ?? '';
		return name.includes('.');
	};

	const getCompletedPatchChangeLineSignature = (
		patch: string,
	): string | undefined => {
		const stablePatch = patch.endsWith('\n')
			? patch
			: patch.slice(0, patch.lastIndexOf('\n') + 1);
		if (!stablePatch) return undefined;

		let changeLines = 0;
		let stableChangeLength = 0;
		let lineDirectiveCount = 0;
		for (const line of stablePatch.split('\n')) {
			if (
				(line.startsWith('+') && !line.startsWith('+++')) ||
				(line.startsWith('-') && !line.startsWith('---'))
			) {
				changeLines += 1;
				stableChangeLength += line.length;
			} else if (
				/^\*\*\* (?:Delete Lines in|Replace Lines in|Insert Before in|Insert After in): /.test(
					line,
				) ||
				line.startsWith('*** Lines:') ||
				line.startsWith('*** Line:') ||
				line.startsWith('*** With:')
			) {
				lineDirectiveCount += 1;
			}
		}

		if (changeLines > 0) return `${changeLines}:${stableChangeLength}`;
		return lineDirectiveCount > 0
			? `lines:${lineDirectiveCount}:${stablePatch.length}`
			: undefined;
	};

	const extractPathsFromPatch = (patch: string): string[] => {
		const paths = new Set<string>();
		for (const line of patch.split('\n')) {
			const directive = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
			const replaceDirective = line.match(/^\*\*\* Replace in: (.+)$/);
			const lineDirective = line.match(
				/^\*\*\* (?:Delete Lines in|Replace Lines in|Insert Before in|Insert After in): (.+)$/,
			);
			const path =
				directive?.[1] ?? replaceDirective?.[1] ?? lineDirective?.[1];
			if (path) {
				paths.add(path.trim());
				continue;
			}

			const unified = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
			if (unified?.[1] && unified[1] !== '/dev/null') {
				paths.add(unified[1].trim());
			}
		}

		return [...paths];
	};

	type FileContentCache = {
		content: string;
		path: string;
		extension: string;
		lineCount: number;
	};

	const getExtension = (path: string): string =>
		path.split('.').pop()?.toLowerCase() ?? '';

	const updateFileContentCache = (path: string, content: string) => {
		queryClient.setQueryData<FileContentCache>(
			projectScopedKey(['files', 'read', path] as const),
			{
				content,
				path,
				extension: getExtension(path),
				lineCount: content.split('\n').length,
			},
		);
	};

	const mergeReadResultIntoFileCache = (
		path: string,
		result: Record<string, unknown> | null,
		startLine: number | undefined,
		endLine: number | undefined,
	) => {
		if (typeof result?.content !== 'string') return;
		const readContent = result.content;
		if (!startLine || !endLine) {
			updateFileContentCache(path, readContent);
			return;
		}

		queryClient.setQueryData<FileContentCache | undefined>(
			projectScopedKey(['files', 'read', path] as const),
			(current) => {
				if (!current?.content) return current;
				const lines = current.content.split('\n');
				if (lines.at(-1) === '') lines.pop();
				const readLines = readContent.split('\n');
				lines.splice(startLine - 1, endLine - startLine + 1, ...readLines);
				const content = `${lines.join('\n')}\n`;
				return {
					...current,
					content,
					lineCount:
						typeof result.totalLines === 'number'
							? result.totalLines
							: lines.length,
				};
			},
		);
	};

	const invalidateFileContentCache = (path: string) => {
		void queryClient.invalidateQueries({
			queryKey: projectScopedKey(['files', 'read', path] as const),
		});
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

	type EditPreviewToolName = 'edit' | 'multiedit';

	type StringEditPreview = {
		oldString: string;
		newString: string;
	};

	const getPatchTextLines = (value: string): string[] => {
		if (value.length === 0) return [];
		const lines = value.split('\n');
		if (value.endsWith('\n')) lines.pop();
		return lines;
	};

	const appendStringEditPatchHunk = (
		lines: string[],
		edit: StringEditPreview,
	) => {
		lines.push('@@');
		for (const line of getPatchTextLines(edit.oldString)) {
			lines.push(`-${line}`);
		}
		for (const line of getPatchTextLines(edit.newString)) {
			lines.push(`+${line}`);
		}
	};

	const buildStringEditPatchPreview = (
		path: string,
		edits: StringEditPreview[],
	): string | undefined => {
		const validEdits = edits.filter(
			(edit) => edit.oldString.length > 0 || edit.newString.length > 0,
		);
		if (validEdits.length === 0) return undefined;

		const lines = ['*** Begin Patch', `*** Update File: ${path}`];
		for (const edit of validEdits) appendStringEditPatchHunk(lines, edit);
		lines.push('*** End Patch', '');
		return lines.join('\n');
	};

	const getMultiEditPreviewEdits = (
		args: Record<string, unknown> | null,
		buffer: string,
	): StringEditPreview[] => {
		const edits = Array.isArray(args?.edits) ? args.edits : [];
		const parsedEdits = edits.flatMap((edit) => {
			if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return [];
			const record = edit as Record<string, unknown>;
			return typeof record.oldString === 'string' &&
				typeof record.newString === 'string'
				? [{ oldString: record.oldString, newString: record.newString }]
				: [];
		});
		return parsedEdits.length > 0
			? parsedEdits
			: extractStreamingMultiEditPreviewEdits(buffer);
	};

	const getEditPreviewPatch = (
		toolName: EditPreviewToolName,
		path: string,
		args: Record<string, unknown> | null,
		buffer: string,
		artifact: Record<string, unknown> | null,
	): string | undefined => {
		if (typeof artifact?.patch === 'string') return artifact.patch;

		if (toolName === 'edit') {
			const oldString = getStringArg(args, buffer, 'oldString');
			const newString = getStringArg(args, buffer, 'newString');
			return oldString !== undefined && newString !== undefined
				? buildStringEditPatchPreview(path, [{ oldString, newString }])
				: undefined;
		}

		const edits = getMultiEditPreviewEdits(args, buffer);
		return buildStringEditPatchPreview(path, edits);
	};

	const handleReadToolActivity = (
		eventType: string,
		payload: Record<string, unknown> | undefined,
		delta?: string | null,
	) => {
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
		if (eventType === 'tool.result' && !failed) {
			mergeReadResultIntoFileCache(path, result, startLine, endLine);
		}

		if (!isActive()) return;
		const viewerStore = useViewerTabsStore.getState();
		if (!viewerStore.followToolActivity) {
			return;
		}

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
		const summary =
			result?.summary && typeof result.summary === 'object'
				? (result.summary as Record<string, unknown>)
				: undefined;
		const changeCount =
			typeof summary?.additions === 'number' &&
			typeof summary.deletions === 'number'
				? {
						additions: summary.additions,
						removals: summary.deletions,
					}
				: undefined;
		if (status === 'success') {
			if (content !== undefined) updateFileContentCache(path, content);
			else invalidateFileContentCache(path);
		}

		if (!isActive()) return;
		const viewerStore = useViewerTabsStore.getState();
		if (!viewerStore.followToolActivity) return;

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
			changeCount,
			status,
			error: extractErrorMessage(payload),
		});
	};

	const handleApplyPatchToolActivity = (
		eventType: string,
		payload: Record<string, unknown> | undefined,
		delta?: string | null,
	) => {
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

		const patch =
			(typeof artifact?.patch === 'string' ? artifact.patch : undefined) ??
			(status === 'streaming'
				? getStreamingPatchPreviewContent(args, buffer)
				: getStringArg(args, buffer, 'patch'));
		if (!patch) return;

		const previewKey = callId ?? 'apply_patch';
		const lineSignature =
			status === 'streaming'
				? getCompletedPatchChangeLineSignature(patch)
				: undefined;
		if (status === 'streaming') {
			const last = toolPreviewEmitRef.current.get(previewKey);
			if (last?.lineSignature === lineSignature) return;
		}

		const patchPaths = extractPathsFromPatch(patch);
		if (patchPaths.length === 0) return;
		if (status === 'success') {
			for (const path of patchPaths) invalidateFileContentCache(path);
		}

		if (!isActive()) return;
		const viewerStore = useViewerTabsStore.getState();
		if (!viewerStore.followToolActivity) return;

		const matchingFileTabs = viewerStore.tabs.filter(
			(
				tab,
			): tab is Extract<(typeof viewerStore.tabs)[number], { type: 'file' }> =>
				tab.type === 'file' &&
				patchPaths.some((path) => patchPathMayReferToTarget(path, tab.path)),
		);
		const activeMatchingFileTab = matchingFileTabs.find(
			(tab) => tab.id === viewerStore.activeTabId,
		);
		const fallbackPath = patchPaths.find(isLikelyCompletePatchPath);
		if (!activeMatchingFileTab && !matchingFileTabs[0] && !fallbackPath) return;
		const targetPath =
			activeMatchingFileTab?.path ?? matchingFileTabs[0]?.path ?? fallbackPath;
		if (!targetPath) return;

		viewerStore.openToolPreviewTab({
			path: targetPath,
			toolName: 'apply_patch',
			callId,
			patch,
			changedLines: getChangedLinesForPath(result, targetPath),
			status,
			error: extractErrorMessage(payload),
		});

		if (status === 'streaming') {
			toolPreviewEmitRef.current.set(previewKey, {
				emittedAt: Date.now(),
				contentLength: buffer.length,
				lineSignature,
			});
		}
	};

	const handleEditToolActivity = (
		eventType: string,
		payload: Record<string, unknown> | undefined,
		delta?: string | null,
	) => {
		const name = getToolEventName(payload);
		if (name !== 'edit' && name !== 'multiedit') return;

		const args = getToolArgsForViewer(payload, delta);
		const buffer = getBufferedToolInput(payload);
		const artifact = getArtifactRecord(payload);
		const result = getResultRecord(payload);
		const path =
			(typeof result?.path === 'string' ? result.path : undefined) ??
			getStringArg(args, buffer, 'path', true);
		if (!path) return;

		const failed = result?.ok === false || eventType === 'error';
		const status = failed
			? 'error'
			: eventType === 'tool.result'
				? 'success'
				: 'streaming';
		const callId = getToolEventCallId(payload) ?? undefined;
		const patch = getEditPreviewPatch(name, path, args, buffer, artifact);
		if (status === 'success') invalidateFileContentCache(path);
		if (!patch) return;

		const previewKey = callId ?? `${name}:${path}`;
		const lineSignature =
			status === 'streaming'
				? getCompletedPatchChangeLineSignature(patch)
				: undefined;
		if (status === 'streaming') {
			const last = toolPreviewEmitRef.current.get(previewKey);
			if (last?.lineSignature === lineSignature) return;
		}

		if (!isActive()) return;
		const viewerStore = useViewerTabsStore.getState();
		if (!viewerStore.followToolActivity) return;

		viewerStore.openToolPreviewTab({
			path,
			toolName: name,
			callId,
			patch,
			status,
			error: extractErrorMessage(payload),
		});

		if (status === 'streaming') {
			toolPreviewEmitRef.current.set(previewKey, {
				emittedAt: Date.now(),
				contentLength: buffer.length,
				lineSignature,
			});
		}
	};

	const handleBrowserToolActivity = (
		eventType: string,
		payload: Record<string, unknown> | undefined,
	) => {
		if (eventType !== 'tool.result') return;
		const result = getToolEventResult(payload);
		if (!result || typeof result !== 'object' || Array.isArray(result)) return;
		const resultRecord = result as Record<string, unknown>;
		if (resultRecord.action !== 'open') return;
		const url = resultRecord.url;
		if (typeof url !== 'string' || !url.trim()) return;
		const kind = resultRecord.kind === 'simulator' ? 'simulator' : 'browser';
		const title =
			typeof resultRecord.title === 'string' && resultRecord.title.trim()
				? resultRecord.title
				: kind === 'simulator'
					? 'Simulator'
					: 'Browser';
		const newTab =
			kind === 'browser' && resultRecord.newTab === true ? true : undefined;
		const id =
			typeof resultRecord.tabId === 'string' && resultRecord.tabId.trim()
				? resultRecord.tabId
				: undefined;
		if (!isActive()) return;
		useViewerTabsStore.getState().openBrowserTab(url, {
			id,
			kind,
			title,
			newTab,
		});
	};

	const handleToolActivityViewerEvent = (
		eventType: string,
		payload: Record<string, unknown> | undefined,
		delta?: string | null,
	) => {
		const name = getToolEventName(payload);
		if (name === 'read') handleReadToolActivity(eventType, payload, delta);
		if (name === 'write') handleWriteToolActivity(eventType, payload, delta);
		if (name === 'edit' || name === 'multiedit') {
			handleEditToolActivity(eventType, payload, delta);
		}
		if (name === 'apply_patch') {
			handleApplyPatchToolActivity(eventType, payload, delta);
		}
		if (name === 'browser') {
			handleBrowserToolActivity(eventType, payload);
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

	// Streaming text/reasoning deltas arrive faster than the browser can
	// usefully repaint (often several per frame). Applying each one
	// synchronously forces a full thread re-render and a full markdown
	// re-parse per token, which makes streaming look jagged. Instead we
	// coalesce deltas and flush them at most once per animation frame.
	type PendingDelta = {
		messageId: string;
		partId: string;
		type: 'text' | 'reasoning';
		delta: string;
		stepIndex: number | null;
	};

	const pendingDeltas = new Map<string, PendingDelta>();
	let deltaFlushHandle: ReturnType<typeof requestAnimationFrame> | null = null;

	const buildStreamingPart = (
		targetMessage: Message,
		entry: PendingDelta,
		index: number,
	): MessagePart => ({
		id: entry.partId,
		messageId: entry.messageId,
		index,
		stepIndex: entry.stepIndex,
		type: entry.type,
		content: JSON.stringify({ text: entry.delta }),
		contentJson: { text: entry.delta },
		agent: targetMessage.agent,
		provider: targetMessage.provider,
		model: targetMessage.model,
		startedAt: Date.now(),
		completedAt: null,
		toolName: null,
		toolCallId: null,
		toolDurationMs: null,
	});

	const flushPendingDeltas = () => {
		if (deltaFlushHandle !== null) {
			cancelAnimationFrame(deltaFlushHandle);
			deltaFlushHandle = null;
		}
		if (pendingDeltas.size === 0) return;
		const batch = [...pendingDeltas.values()];
		pendingDeltas.clear();
		updateThreadMessages((oldMessages) => {
			if (!oldMessages) return oldMessages;
			let nextMessages: Message[] | null = null;
			for (const entry of batch) {
				const source = nextMessages ?? oldMessages;
				const messageIndex = source.findIndex(
					(message) => message.id === entry.messageId,
				);
				if (messageIndex === -1) continue;
				if (!nextMessages) nextMessages = [...oldMessages];
				const targetMessage = nextMessages[messageIndex];
				const parts = targetMessage.parts ? [...targetMessage.parts] : [];
				const partIndex = parts.findIndex((part) => part.id === entry.partId);
				if (partIndex === -1) {
					parts.push(
						buildStreamingPart(
							targetMessage,
							entry,
							getOptimisticPartIndex(parts, entry.stepIndex),
						),
					);
				} else {
					const existing = parts[partIndex];
					const nextText = `${extractText(existing)}${entry.delta}`;
					parts[partIndex] = {
						...existing,
						content: JSON.stringify({ text: nextText }),
						contentJson: { text: nextText },
						stepIndex: entry.stepIndex ?? existing.stepIndex ?? null,
						completedAt: null,
					};
				}
				nextMessages[messageIndex] = { ...targetMessage, parts };
			}
			return nextMessages ?? oldMessages;
		});
	};

	const enqueueStreamingDelta = (
		type: 'text' | 'reasoning',
		payload: Record<string, unknown> | undefined,
	) => {
		const messageId =
			typeof payload?.messageId === 'string' ? payload.messageId : null;
		const partId = typeof payload?.partId === 'string' ? payload.partId : null;
		const delta = typeof payload?.delta === 'string' ? payload.delta : null;
		if (!messageId || !partId || delta === null) return;
		const stepIndex =
			typeof payload?.stepIndex === 'number' ? payload.stepIndex : null;
		const key = `${messageId}:${partId}`;
		const existing = pendingDeltas.get(key);
		if (existing) {
			existing.delta += delta;
			if (stepIndex !== null) existing.stepIndex = stepIndex;
		} else {
			pendingDeltas.set(key, { messageId, partId, type, delta, stepIndex });
		}
		if (deltaFlushHandle === null) {
			deltaFlushHandle = requestAnimationFrame(flushPendingDeltas);
		}
	};

	const applyReasoningDelta = (
		payload: Record<string, unknown> | undefined,
	) => {
		enqueueStreamingDelta('reasoning', payload);
	};

	const applyMessageDelta = (payload: Record<string, unknown> | undefined) => {
		const payloadType =
			typeof payload?.type === 'string' ? payload.type : undefined;
		if (payloadType === 'error') {
			flushPendingDeltas();
			upsertErrorPart(payload);
			return;
		}
		enqueueStreamingDelta('text', payload);
	};

	const toRecord = (value: unknown): Record<string, unknown> | null => {
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			return value as Record<string, unknown>;
		}
		return null;
	};

	const parseErrorContent = (
		payload: Record<string, unknown>,
	): Record<string, unknown> => {
		const contentRecord = toRecord(payload.content);
		if (contentRecord) return contentRecord;

		if (typeof payload.content === 'string') {
			try {
				const parsed = JSON.parse(payload.content);
				const parsedRecord = toRecord(parsed);
				if (parsedRecord) return parsedRecord;
			} catch {}
		}

		const message =
			typeof payload.error === 'string'
				? payload.error
				: typeof payload.message === 'string'
					? payload.message
					: 'Assistant run failed';
		return {
			message,
			type: typeof payload.errorType === 'string' ? payload.errorType : 'error',
			details: toRecord(payload.details) ?? undefined,
			isAborted: payload.isAborted === true,
			autoCompacted: payload.autoCompacted === true,
		};
	};

	const upsertErrorPart = (payload: Record<string, unknown> | undefined) => {
		const messageId =
			typeof payload?.messageId === 'string' ? payload.messageId : null;
		if (!payload || !messageId) return;

		const contentJson = parseErrorContent(payload);
		const content = JSON.stringify(contentJson);
		const errorMessage =
			typeof contentJson.message === 'string'
				? contentJson.message
				: typeof payload.error === 'string'
					? payload.error
					: 'Assistant run failed';
		const stepIndex =
			typeof payload.stepIndex === 'number' ? payload.stepIndex : null;
		const partId =
			typeof payload.partId === 'string'
				? payload.partId
				: `error-${messageId}`;

		updateThreadMessages((oldMessages) => {
			if (!oldMessages) return oldMessages;
			const nextMessages = [...oldMessages];
			const messageIndex = nextMessages.findIndex(
				(message) => message.id === messageId,
			);
			if (messageIndex === -1) return oldMessages;
			const targetMessage = nextMessages[messageIndex];
			const parts = targetMessage.parts ? [...targetMessage.parts] : [];
			const partIndex = parts.findIndex((part) => part.id === partId);
			if (partIndex === -1) {
				const newPart: MessagePart = {
					id: partId,
					messageId,
					index: getOptimisticPartIndex(parts, stepIndex),
					stepIndex,
					type: 'error',
					content,
					contentJson,
					agent: targetMessage.agent,
					provider: targetMessage.provider,
					model: targetMessage.model,
					startedAt: Date.now(),
					completedAt: Date.now(),
					toolName: null,
					toolCallId: null,
					toolDurationMs: null,
				};
				parts.push(newPart);
			} else {
				parts[partIndex] = {
					...parts[partIndex],
					content,
					contentJson,
					stepIndex: stepIndex ?? parts[partIndex].stepIndex ?? null,
					completedAt: Date.now(),
				};
			}
			nextMessages[messageIndex] = {
				...targetMessage,
				status: 'error',
				completedAt: targetMessage.completedAt ?? Date.now(),
				error: errorMessage,
				parts,
			};
			return nextMessages;
		});
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

		updateThreadMessages((oldMessages) => {
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
		});
	};

	const accumulateToolInputDelta = (
		payload: Record<string, unknown> | undefined,
		delta: string,
	) => {
		if (!payload) return;
		const callId = getToolEventCallId(payload);
		const name = getToolEventName(payload);
		if (!name) return;
		updateThreadMessages((oldMessages) => {
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
		});
	};

	const accumulateToolOutputDelta = (
		payload: Record<string, unknown> | undefined,
		delta: string,
	) => {
		if (!payload) return;
		const callId = getToolEventCallId(payload);
		const name = getToolEventName(payload);
		if (!name) return;
		updateThreadMessages((oldMessages) => {
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
		});
	};

	const resolveEphemeralToolCall = (
		payload: Record<string, unknown> | undefined,
	) => {
		const callId = getToolEventCallId(payload);
		if (!callId) return;
		const payloadName = getToolEventName(payload);
		const payloadMessageId =
			typeof payload?.messageId === 'string' ? payload.messageId : null;
		const payloadStepIndex =
			typeof payload?.stepIndex === 'number' ? payload.stepIndex : null;
		const payloadResult = payload?.result;
		const payloadArtifact = payload?.artifact;
		const payloadArgs = getToolEventArgs(payload);
		updateThreadMessages((oldMessages) => {
			if (!oldMessages) return oldMessages;
			let changed = false;
			const now = Date.now();
			const nextMessages = oldMessages.map((message) => {
				if (payloadMessageId && message.id !== payloadMessageId) {
					return message;
				}
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
		});
	};

	const removeEphemeralToolCall = (
		payload: Record<string, unknown> | undefined,
	) => {
		const callId = getToolEventCallId(payload);
		if (!callId) return;
		updateThreadMessages((oldMessages) => {
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
		});
	};

	const clearEphemeralForMessage = (messageId: string | null) => {
		if (!messageId) return;
		updateThreadMessages((oldMessages) => {
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
		});
	};

	const markMessageCompleted = (
		payload: Record<string, unknown> | undefined,
	) => {
		const id = typeof payload?.id === 'string' ? payload.id : null;
		if (!id) return;
		updateThreadMessages((oldMessages) => {
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
		});
	};

	const unsubscribe = stream.on((event) => {
		// console.log('[useSessionStream] Event received:', event);
		const payload = event.payload as Record<string, unknown> | undefined;

		// Apply any buffered streaming text before handling structural events
		// (tool calls, completion, etc.) so ordering stays correct.
		if (
			event.type !== 'message.part.delta' &&
			event.type !== 'reasoning.delta'
		) {
			flushPendingDeltas();
		}

		switch (event.type) {
			case 'message.created': {
				const role = typeof payload?.role === 'string' ? payload.role : null;
				const id = typeof payload?.id === 'string' ? payload.id : null;
				if (role === 'assistant' && id) {
					if (isActive())
						useViewerTabsStore.getState().resetFollowTurnChanges();
					assistantMessageIdRef.current = id;
					queueMessageIdInCache(queryClient, queueStateQueryKey, id);
				}
				if (id && role) {
					const agent = typeof payload?.agent === 'string' ? payload.agent : '';
					const provider =
						typeof payload?.provider === 'string' ? payload.provider : '';
					const model = typeof payload?.model === 'string' ? payload.model : '';
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
					updateThreadMessages((oldMessages) => {
						if (!oldMessages) return oldMessages;
						if (oldMessages.some((m) => m.id === id)) return oldMessages;
						const baseMessages =
							role === 'user' && content
								? oldMessages.filter(
										(message) =>
											!optimisticMessageMatchesText(message, content),
									)
								: oldMessages;
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
						// Stream events describe the live edge, so a created message
						// belongs at the tail. Keeping the insertion append-only
						// means no already-rendered row can change position while a
						// turn streams; only a clock-skewed event falls back to a
						// (stable) sort.
						const next = [...baseMessages, newMessage];
						const previous = baseMessages[baseMessages.length - 1];
						if (previous && previous.createdAt > newMessage.createdAt) {
							next.sort((a, b) => a.createdAt - b.createdAt);
						}
						return next;
					});
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
				if (id) {
					queryClient.setQueryData<ReturnType<typeof normalizeQueueState>>(
						queueStateQueryKey,
						(current) => {
							if (!current || current.currentMessageId !== id) return current;
							return normalizeQueueState({
								currentMessageId: null,
								queuedMessages: [],
								isRunning: false,
							});
						},
					);
				}
				queryClient.invalidateQueries({
					queryKey: messagesQueryKey,
				});
				queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
				queryClient.invalidateQueries({
					queryKey: sessionQueryKey,
				});
				queryClient.invalidateQueries({
					queryKey: projectScopedKey(['goal', sessionId] as const),
				});
				queryClient.invalidateQueries({
					queryKey: projectScopedKey(['goals', 'project'] as const),
				});
				queryClient.invalidateQueries({
					queryKey: projectScopedKey(['subagents', sessionId] as const),
				});
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
			case 'shell.job.updated': {
				const job = payload?.job;
				if (job && typeof job === 'object' && !Array.isArray(job)) {
					upsertShellJob(job as ShellJob);
				}
				break;
			}
			case 'shell.job.output': {
				const jobId = typeof payload?.jobId === 'string' ? payload.jobId : null;
				const delta = typeof payload?.delta === 'string' ? payload.delta : null;
				const updatedAt =
					typeof payload?.updatedAt === 'number'
						? payload.updatedAt
						: Date.now();
				if (jobId && delta) appendShellJobOutput(jobId, delta, updatedAt);
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
			case 'shell.secure_input.required': {
				const promptId =
					typeof payload?.promptId === 'string' ? payload.promptId : null;
				const prompt =
					typeof payload?.prompt === 'string' ? payload.prompt : null;
				if (promptId && prompt) {
					addPendingInput({
						promptId,
						prompt,
						messageId:
							typeof payload?.messageId === 'string'
								? payload.messageId
								: undefined,
						callId:
							typeof payload?.callId === 'string' ? payload.callId : undefined,
						inputKind: payload?.inputKind === 'text' ? 'text' : 'password',
						allowRemember: payload?.allowRemember === true,
						allowEmpty: allowsEmptySecureInput(
							prompt,
							payload?.allowEmpty === true,
						),
						createdAt: Date.now(),
					});
				}
				break;
			}
			case 'shell.secure_input.resolved': {
				const promptId =
					typeof payload?.promptId === 'string' ? payload.promptId : null;
				if (promptId) {
					removePendingInput(promptId);
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
					upsertErrorPart(payload);
				}
				queryClient.invalidateQueries({
					queryKey: messagesQueryKey,
				});
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
					updateThreadMessages((oldMessages) => {
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
					});
				}
				break;
			}
			case 'goal.updated': {
				queryClient.invalidateQueries({
					queryKey: projectScopedKey(['goal', sessionId] as const),
				});
				queryClient.invalidateQueries({
					queryKey: projectScopedKey(['goals', 'project'] as const),
				});
				queryClient.invalidateQueries({
					queryKey: projectScopedKey(['subagents', sessionId] as const),
				});
				break;
			}
			case 'session.updated': {
				queryClient.invalidateQueries({
					queryKey: sessionQueryKey,
				});
				queryClient.invalidateQueries({
					queryKey: projectScopedKey(['subagents', sessionId] as const),
				});
				break;
			}
			case 'queue.updated': {
				const queueState = normalizeQueueState({
					currentMessageId: payload?.currentMessageId as string | null,
					queuedMessages: (payload?.queuedMessages ?? []) as Array<{
						messageId: string;
						position: number;
					}>,
					isRunning:
						typeof payload?.isRunning === 'boolean'
							? payload.isRunning
							: undefined,
				});
				queryClient.setQueryData(queueStateQueryKey, queueState);
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
				queryClient.invalidateQueries({
					queryKey: sessionQueryKey,
				});
			}
		}
	});

	return () => {
		if (deltaFlushHandle !== null) {
			cancelAnimationFrame(deltaFlushHandle);
			deltaFlushHandle = null;
		}
		pendingDeltas.clear();
		unsubscribe();
		stream.release();
	};
}
