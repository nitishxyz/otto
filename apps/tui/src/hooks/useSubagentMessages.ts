import { useEffect, useState } from 'react';
import type { Message } from '../types.ts';
import type { SubagentDetailData } from '../components/activity/types.ts';
import { loadSessionMessages } from '../stream/client.ts';

export function useSubagentMessages(
	childSessionId: string | null,
	isRunning: boolean,
): SubagentDetailData {
	const [messages, setMessages] = useState<Message[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setMessages([]);
		setError(null);
		if (!childSessionId) return;
		let cancelled = false;
		let requestRunning = false;
		const load = async () => {
			if (requestRunning) return;
			requestRunning = true;
			setLoading(true);
			try {
				const next = await loadSessionMessages(childSessionId);
				if (!cancelled) {
					setMessages(next);
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

	return { messages, loading, error };
}
