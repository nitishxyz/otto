import { getRunnerState } from '../../../runtime/session/queue.ts';
import type { SessionRow } from './types.ts';

export function parseToolCounts(
	toolCountsJson: string | null,
): Record<string, unknown> | undefined {
	if (!toolCountsJson) return undefined;
	try {
		const parsed = JSON.parse(toolCountsJson);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {}
	return undefined;
}

export function normalizeSessionRow(
	row: SessionRow,
	options: { includeRunning?: boolean; projectRoot?: string } = {},
) {
	const { toolCountsJson: _toolCountsJson, ...rest } = row;
	const counts = parseToolCounts(row.toolCountsJson);
	const base = counts ? { ...rest, toolCounts: counts } : rest;
	if (!options.includeRunning) return base;
	const isRunning =
		getRunnerState(row.id, options.projectRoot ?? row.projectPath)?.running ??
		false;
	return { ...base, isRunning };
}
