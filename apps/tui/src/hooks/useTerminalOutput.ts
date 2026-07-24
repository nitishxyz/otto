import { useEffect, useState } from 'react';
import { getBaseUrl, getProjectContext, getProjectQuery } from '../api.ts';

const MAX_OUTPUT_CHARS = 40_000;

function appendBounded(current: string, next: string): string {
	return `${current}${next}`.slice(-MAX_OUTPUT_CHARS);
}

export function useTerminalOutput(terminalId: string | null): {
	output: string;
	exitCode: number | null;
	error: string | null;
} {
	const [output, setOutput] = useState('');
	const [exitCode, setExitCode] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setOutput('');
		setExitCode(null);
		setError(null);
		if (!terminalId) return;

		const controller = new AbortController();
		const connect = async () => {
			try {
				const url = new URL(
					`/v1/terminals/${encodeURIComponent(terminalId)}/output`,
					getBaseUrl(),
				);
				for (const [key, value] of Object.entries(getProjectQuery())) {
					url.searchParams.set(key, String(value));
				}
				const { authToken } = getProjectContext();
				const response = await fetch(url, {
					signal: controller.signal,
					headers: authToken
						? {
								Authorization: `Bearer ${authToken}`,
								'X-Otto-Server-Token': authToken,
							}
						: undefined,
				});
				if (!response.ok || !response.body) {
					throw new Error(`terminal output returned ${response.status}`);
				}
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';
				while (!controller.signal.aborted) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const frames = buffer.split('\n\n');
					buffer = frames.pop() ?? '';
					for (const frame of frames) {
						const data = frame
							.split('\n')
							.filter((line) => line.startsWith('data:'))
							.map((line) => line.slice(5).trimStart())
							.join('\n');
						if (!data) continue;
						try {
							const event = JSON.parse(data) as Record<string, unknown>;
							if (event.type === 'data' && typeof event.line === 'string') {
								setOutput((current) =>
									appendBounded(current, event.line as string),
								);
							} else if (
								event.type === 'exit' &&
								typeof event.exitCode === 'number'
							) {
								setExitCode(event.exitCode);
							}
						} catch {}
					}
				}
			} catch (cause) {
				if (!controller.signal.aborted) {
					setError(
						cause instanceof Error ? cause.message : 'Terminal output failed',
					);
				}
			}
		};
		void connect();
		return () => controller.abort();
	}, [terminalId]);

	return { output, exitCode, error };
}
