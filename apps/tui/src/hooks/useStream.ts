import { useEffect, useReducer, useRef, useState, useCallback } from 'react';
import { buildSessionStreamUrl } from '@ottocode/api';
import { getBaseUrl, getProjectContext, getProjectKey } from '../api.ts';
import { messageReducer } from '../stream/reducer.ts';
import {
	connectSSE,
	getQueuedMessageIds,
	getStreamingMessageIdAfterTerminalEvent,
	hasSameQueuedMessageOrder,
	loadPendingSecureInputs,
	loadSessionMessagePage,
	loadSessionQueueState,
	reconcilePendingSecureInputs,
} from '../stream/client.ts';
import type { PendingApproval, PendingSecureInput } from '../types.ts';

/**
 * Subscribes to a session's SSE stream and exposes live message state,
 * streaming status, queue info, and pending approvals/secure inputs.
 * Reducer logic lives in stream/reducer.ts; transport in stream/client.ts.
 */
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
	const [hasOlderMessages, setHasOlderMessages] = useState(false);
	const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
	const projectKey = getProjectKey();
	const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>(
		[],
	);
	const [pendingSecureInputs, setPendingSecureInputs] = useState<
		PendingSecureInput[]
	>([]);
	const abortRef = useRef<AbortController | null>(null);
	const olderMessagesCursorRef = useRef<string | null>(null);
	const olderMessagesRequestRef = useRef(false);
	const currentSessionIdRef = useRef(sessionId);
	currentSessionIdRef.current = sessionId;
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

	const loadOlderMessages = useCallback(async () => {
		if (
			!sessionId ||
			olderMessagesRequestRef.current ||
			!olderMessagesCursorRef.current
		) {
			return false;
		}
		olderMessagesRequestRef.current = true;
		setIsLoadingOlderMessages(true);
		try {
			const page = await loadSessionMessagePage(
				sessionId,
				olderMessagesCursorRef.current,
			);
			if (currentSessionIdRef.current !== sessionId) return false;
			dispatch({ type: 'PREPEND', messages: page.items });
			olderMessagesCursorRef.current = page.nextCursor;
			setHasOlderMessages(page.hasMore && Boolean(page.nextCursor));
			return page.items.length > 0;
		} catch {
			return false;
		} finally {
			olderMessagesRequestRef.current = false;
			if (currentSessionIdRef.current === sessionId) {
				setIsLoadingOlderMessages(false);
			}
		}
	}, [sessionId]);

	useEffect(() => {
		void projectKey;
		if (!sessionId) {
			dispatch({ type: 'CLEAR' });
			setStreamingMessageId(null);
			setQueueSize(0);
			setQueuedMessageIds(new Set());
			setHasOlderMessages(false);
			setIsLoadingOlderMessages(false);
			olderMessagesRequestRef.current = false;
			olderMessagesCursorRef.current = null;
			setPendingApprovals([]);
			setPendingSecureInputs([]);
			return;
		}

		const controller = new AbortController();
		abortRef.current = controller;
		const baseUrl = getBaseUrl();

		dispatch({ type: 'CLEAR' });
		setStreamingMessageId(null);
		setQueueSize(0);
		setQueuedMessageIds(new Set());
		setHasOlderMessages(false);
		setIsLoadingOlderMessages(false);
		olderMessagesCursorRef.current = null;
		setPendingApprovals([]);
		setPendingSecureInputs([]);

		loadSessionMessagePage(sessionId)
			.then((page) => {
				if (!controller.signal.aborted) {
					dispatch({ type: 'LOAD', messages: page.items });
					olderMessagesCursorRef.current = page.nextCursor;
					setHasOlderMessages(page.hasMore && Boolean(page.nextCursor));
				}
			})
			.catch(() => {});
		loadPendingSecureInputs(sessionId)
			.then((inputs) => {
				if (!controller.signal.aborted) setPendingSecureInputs(inputs);
			})
			.catch(() => {
				if (!controller.signal.aborted) setPendingSecureInputs([]);
			});
		loadSessionQueueState(sessionId, baseUrl)
			.then((queueState) => {
				if (controller.signal.aborted || !queueState) return;
				const currentMsgId =
					typeof queueState.currentMessageId === 'string'
						? queueState.currentMessageId
						: null;
				setStreamingMessageId(currentMsgId);
				const nextIds = getQueuedMessageIds(queueState.queuedMessages);
				setQueueSize(nextIds.length);
				setQueuedMessageIds(new Set(nextIds));
			})
			.catch(() => {});

		const { projectId, projectRoot } = getProjectContext();
		const streamUrl = buildSessionStreamUrl({
			baseUrl,
			sessionId,
			projectId: projectId ?? undefined,
			projectPath: projectRoot ?? undefined,
		});
		connectSSE(streamUrl, controller.signal, (event) => {
			if (controller.signal.aborted) return;
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
									inputKind: payload.inputKind === 'text' ? 'text' : 'password',
									allowRemember: payload.allowRemember === true,
									allowEmpty: payload.allowEmpty === true,
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
					setStreamingMessageId((currentMessageId) =>
						getStreamingMessageIdAfterTerminalEvent(currentMessageId, payload),
					);
					onMessageCompletedRef.current?.();
					setTimeout(() => {
						if (controller.signal.aborted) return;
						loadSessionMessagePage(sessionId)
							.then((page) => {
								if (!controller.signal.aborted) {
									dispatch({
										type: 'REFRESH_LATEST',
										messages: page.items,
									});
								}
							})
							.catch(() => {});
					}, 300);
					break;
				case 'message.updated':
					dispatch({ type: 'MESSAGE_UPDATED', payload });
					break;
				case 'error':
					dispatch({ type: 'ERROR', payload });
					setStreamingMessageId((currentMessageId) =>
						getStreamingMessageIdAfterTerminalEvent(currentMessageId, payload),
					);
					break;
				case 'session.updated': {
					onSessionUpdateRef.current?.(payload);
					break;
				}
				case 'queue.updated': {
					const currentMsgId =
						typeof payload.currentMessageId === 'string'
							? payload.currentMessageId
							: null;
					setStreamingMessageId(currentMsgId);
					const nextIds = getQueuedMessageIds(payload.queuedMessages);
					const queueLength =
						typeof payload.queueLength === 'number'
							? payload.queueLength
							: nextIds.length;
					setQueueSize(queueLength);
					setQueuedMessageIds((prev) => {
						if (hasSameQueuedMessageOrder(prev, nextIds)) {
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
	}, [sessionId, projectKey]);

	useEffect(() => {
		if (!sessionId) return;

		let cancelled = false;
		let refreshInFlight = false;
		const refreshPendingSecureInputs = async () => {
			if (refreshInFlight) return;
			refreshInFlight = true;
			try {
				const inputs = await loadPendingSecureInputs(sessionId);
				if (!cancelled) {
					setPendingSecureInputs((current) =>
						reconcilePendingSecureInputs(current, inputs),
					);
				}
			} catch {
				// Keep the current prompt visible until the server can be reached again.
			} finally {
				refreshInFlight = false;
			}
		};

		void refreshPendingSecureInputs();
		const interval = setInterval(refreshPendingSecureInputs, 1000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [sessionId]);

	const reload = () => {
		if (!sessionId) return;
		loadSessionMessagePage(sessionId)
			.then((page) =>
				dispatch({ type: 'REFRESH_LATEST', messages: page.items }),
			)
			.catch(() => {});
	};

	const isStreaming = streamingMessageId !== null;
	return {
		messages,
		isStreaming,
		streamingMessageId,
		hasOlderMessages,
		isLoadingOlderMessages,
		loadOlderMessages,
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
