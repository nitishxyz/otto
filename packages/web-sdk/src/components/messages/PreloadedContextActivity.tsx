import { useMemo } from 'react';
import type { PreloadedContextSummary } from './assistantTurnModel';
import { CompactActivityGroup } from './CompactActivityGroup';
import type { CompactActivityEntry } from './compactActivity';

export function PreloadedContextActivity({
	context,
	showLine,
	compact,
}: {
	context: PreloadedContextSummary;
	showLine: boolean;
	compact?: boolean;
}) {
	const entries = useMemo<CompactActivityEntry[]>(
		() =>
			context.files.map((file, index) => ({
				id: `preloaded-context:${index}:${file.path}:${file.lineRange ?? 'full'}`,
				label: file.lineRange ? `${file.path}:${file.lineRange}` : file.path,
				toolName: 'read',
				path: file.path,
			})),
		[context.files],
	);
	const details = [
		`${context.files.length} ${context.files.length === 1 ? 'file' : 'files'}`,
		...(context.totalBytes !== undefined
			? [`${Math.ceil(context.totalBytes / 1024)} KB`]
			: []),
		...(context.preloadDurationMs !== undefined
			? [`${context.preloadDurationMs}ms`]
			: []),
		...(context.deduplicatedFileCount
			? [`${context.deduplicatedFileCount} duplicate removed`]
			: []),
	];

	return (
		<CompactActivityGroup
			entries={entries}
			titleOverride="Preloaded context"
			detailsOverride={details}
			showLine={showLine}
			collapsed
			compact={compact}
		/>
	);
}
