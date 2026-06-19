import type { Context } from 'hono';
import { toErrorMessage } from '../../../runtime/errors/handling.ts';
import { simulatorState } from './state.ts';

export async function getSimulatorLogs(c: Context) {
	if (!simulatorState.url) {
		return c.json(
			{ ok: false, error: 'No serve-sim preview URL is active' },
			400,
		);
	}
	const logsUrl = new URL('/logs', simulatorState.url).toString();
	try {
		const response = await fetch(logsUrl);
		const text = await response.text();
		return c.json({ ok: response.ok, logs: text, url: logsUrl });
	} catch (error) {
		return c.json(
			{
				ok: false,
				error: toErrorMessage(error),
			},
			500,
		);
	}
}
