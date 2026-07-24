import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	getTerminals,
	listSessionShellJobs,
	listSessionSubagents,
} from '@ottocode/api';
import { getProjectQuery } from '../api.ts';
import type { Message } from '../types.ts';
import type {
	ActivityData,
	ActivityShellJob,
	ActivitySubagent,
	ActivityTerminal,
} from '../components/activity/types.ts';
import {
	extractLatestTodos,
	sortShellJobs,
	sortSubagents,
	sortTerminals,
} from '../lib/activity.ts';

const ACTIVE_REFRESH_MS = 1_500;
const IDLE_REFRESH_MS = 5_000;

export function useActivityData(
	sessionId: string | null,
	messages: Message[],
	enabled: boolean,
): ActivityData {
	const [subagents, setSubagents] = useState<ActivitySubagent[]>([]);
	const [shells, setShells] = useState<ActivityShellJob[]>([]);
	const [terminals, setTerminals] = useState<ActivityTerminal[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const refreshGeneration = useRef(0);
	const requestRunning = useRef(false);

	const todos = useMemo(() => extractLatestTodos(messages), [messages]);
	const hasRunningActivity =
		subagents.some((item) => item.status === 'running') ||
		shells.some((item) => item.status === 'running') ||
		terminals.some((item) => item.status === 'running');

	const load = useCallback(async () => {
		if (requestRunning.current) return;
		requestRunning.current = true;
		const generation = ++refreshGeneration.current;
		setLoading(true);
		try {
			if (!sessionId) {
				const terminalResponse = await getTerminals();
				if (generation !== refreshGeneration.current) return;
				setTerminals(
					sortTerminals(
						(terminalResponse.data?.terminals ?? []) as ActivityTerminal[],
					),
				);
				setError(
					terminalResponse.error ? 'Terminals could not be loaded' : null,
				);
				return;
			}
			const query = getProjectQuery();
			const [subagentResponse, shellResponse, terminalResponse] =
				await Promise.all([
					listSessionSubagents({
						path: { sessionId },
						query,
					} as never),
					listSessionShellJobs({
						path: { sessionId },
						query,
					} as never),
					getTerminals(),
				]);
			if (generation !== refreshGeneration.current) return;
			setSubagents(
				sortSubagents(
					(subagentResponse.data?.subagents ?? []) as ActivitySubagent[],
				),
			);
			setShells(
				sortShellJobs((shellResponse.data?.jobs ?? []) as ActivityShellJob[]),
			);
			setTerminals(
				sortTerminals(
					(terminalResponse.data?.terminals ?? []) as ActivityTerminal[],
				),
			);
			const failed =
				subagentResponse.error || shellResponse.error || terminalResponse.error;
			setError(failed ? 'Some activity could not be loaded' : null);
		} catch {
			if (generation === refreshGeneration.current) {
				setError('Activity could not be loaded');
			}
		} finally {
			if (generation === refreshGeneration.current) setLoading(false);
			requestRunning.current = false;
		}
	}, [sessionId]);

	useEffect(() => {
		refreshGeneration.current += 1;
		requestRunning.current = false;
		setSubagents([]);
		setShells([]);
		if (!enabled) return;
		void load();
	}, [enabled, load]);

	useEffect(() => {
		if (!enabled) return;
		const timer = setInterval(
			() => void load(),
			hasRunningActivity ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS,
		);
		return () => clearInterval(timer);
	}, [enabled, hasRunningActivity, load]);

	return {
		todos,
		subagents,
		shells,
		terminals,
		loading,
		error,
		refresh: () => void load(),
	};
}
