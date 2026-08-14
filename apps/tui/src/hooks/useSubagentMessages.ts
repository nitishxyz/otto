import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '../types.ts';
import type { SubagentDetailData } from '../components/activity/types.ts';
import { loadSessionMessagePage } from '../stream/client.ts';

export function useSubagentMessages(
	childSessionId: string | null,
	isRunning: boolean,
): SubagentDetailData {
	const [messages, setMessages] = useState<Message[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hasOlderMessages, setHasOlderMessages] = useState(false);
	const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
	const olderCursorRef = useRef<string | null>(null);
	const olderRequestRef = useRef(false);
	const currentSessionIdRef = useRef(childSessionId);
	currentSessionIdRef.current = childSessionId;

	const loadOlderMessages = useCallback(async () => {
		if (!childSessionId || olderRequestRef.current || !olderCursorRef.current) {
			return false;
		}
		olderRequestRef.current = true;
		setIsLoadingOlderMessages(true);
		try {
			const page = await loadSessionMessagePage(
				childSessionId,
				olderCursorRef.current,
			);
			if (currentSessionIdRef.current !== childSessionId) return false;
			setMessages((current) => {
				const currentIds = new Set(current.map((message) => message.id));
				return [
					...page.items.filter((message) => !currentIds.has(message.id)),
					...current,
				];
			});
			olderCursorRef.current = page.nextCursor;
			setHasOlderMessages(page.hasMore && Boolean(page.nextCursor));
			return page.items.length > 0;
		} catch {
			return false;
		} finally {
			olderRequestRef.current = false;
			if (currentSessionIdRef.current === childSessionId) {
				setIsLoadingOlderMessages(false);
			}
		}
	}, [childSessionId]);

	useEffect(() => {
		setMessages([]);
		setError(null);
		setHasOlderMessages(false);
		setIsLoadingOlderMessages(false);
		olderCursorRef.current = null;
		olderRequestRef.current = false;
		if (!childSessionId) return;
		let cancelled = false;
		let requestRunning = false;
		const load = async () => {
			if (requestRunning) return;
			requestRunning = true;
			setLoading(true);
			try {
				const page = await loadSessionMessagePage(childSessionId);
				if (!cancelled) {
					setMessages((current) => {
						if (current.length === 0) return page.items;
						const latestById = new Map(
							page.items.map((message) => [message.id, message]),
						);
						const refreshed = current.map(
							(message) => latestById.get(message.id) ?? message,
						);
						const currentIds = new Set(current.map((message) => message.id));
						return [
							...refreshed,
							...page.items.filter((message) => !currentIds.has(message.id)),
						];
					});
					olderCursorRef.current = page.nextCursor;
					setHasOlderMessages(page.hasMore && Boolean(page.nextCursor));
					setError(null);
				}
			} catch {
				if (!cancelled) setError('Sub-agent session could not be loaded');
			} finally {
				requestRunning = false;
				if (!cancelled) setLoading(false);
			}
		};
		void load();
		const timer = isRunning ? setInterval(() => void load(), 1_500) : null;
		return () => {
			cancelled = true;
			if (timer) clearInterval(timer);
		};
	}, [childSessionId, isRunning]);

	return {
		messages,
		loading,
		error,
		hasOlderMessages,
		isLoadingOlderMessages,
		loadOlderMessages,
	};
}
