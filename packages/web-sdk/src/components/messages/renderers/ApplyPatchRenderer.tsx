import { ChevronRight } from 'lucide-react';
import type { GenericRendererProps } from './types';
import { DiffView } from './DiffView';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';

interface ApplyPatchChangeHunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	additions: number;
	deletions: number;
	context?: string;
}

interface ApplyPatchChange {
	filePath: string;
	kind: string;
	hunks: ApplyPatchChangeHunk[];
}

export function ApplyPatchRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	toolName,
}: GenericRendererProps) {
	const artifact = contentJson.artifact;
	const timeStr = formatDuration(toolDurationMs);

	const formatSpan = (start: number, count: number) => {
		if (count <= 1) return `${start}`;
		return `${start}-${start + count - 1}`;
	};

	const formatHunkLabel = (hunk: ApplyPatchChangeHunk) => {
		const left = `-${formatSpan(hunk.oldStart, hunk.oldLines)}`;
		const right = `+${formatSpan(hunk.newStart, hunk.newLines)}`;
		const deltaParts: string[] = [];
		if (hunk.additions > 0) deltaParts.push(`+${hunk.additions}`);
		if (hunk.deletions > 0) deltaParts.push(`-${hunk.deletions}`);
		const delta = deltaParts.length > 0 ? ` (${deltaParts.join(', ')})` : '';
		return `${left} ${right}${delta}`;
	};
	const summary = artifact?.summary || {};
	const files = Number(summary.files || 0);
	const additions = Number(summary.additions || 0);
	const deletions = Number(summary.deletions || 0);
	const patch = artifact?.patch ? String(artifact.patch) : '';

	const changes = Array.isArray(contentJson.result?.changes)
		? (contentJson.result?.changes as ApplyPatchChange[])
		: [];
	const rendererToolName = toolName || contentJson.name || 'apply_patch';
	const titleLabel = rendererToolName.replace(/_/g, ' ');

	const singleFilePath =
		files === 1
			? changes[0]?.filePath ||
				(typeof contentJson.result?.path === 'string'
					? contentJson.result.path
					: typeof contentJson.args?.path === 'string'
						? contentJson.args.path
						: null)
			: null;

	const hasError =
		contentJson.error ||
		(contentJson.result &&
			'ok' in contentJson.result &&
			contentJson.result.ok === false);
	const errorMessage =
		typeof contentJson.error === 'string'
			? contentJson.error
			: contentJson.result &&
					'error' in contentJson.result &&
					typeof contentJson.result.error === 'string'
				? contentJson.result.error
				: null;
	const errorStack =
		contentJson.result &&
		typeof contentJson.result === 'object' &&
		'stack' in contentJson.result &&
		typeof contentJson.result.stack === 'string'
			? contentJson.result.stack
			: undefined;

	return (
		<div className="text-[12px]">
			<button
				type="button"
				onClick={onToggle}
				className={`flex items-center gap-2 transition-colors w-full ${
					hasError
						? 'text-red-700 dark:text-red-300 hover:text-red-600 dark:hover:text-red-200'
						: 'text-purple-700 dark:text-purple-300 hover:text-purple-600 dark:hover:text-purple-200'
				}`}
			>
				<ChevronRight
					className={`h-3 w-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
				/>
				<span className="font-medium flex-shrink-0">
					{titleLabel}
					{hasError ? ' error' : ''}
				</span>
				<span className="text-muted-foreground/70 flex-shrink-0">·</span>
				{singleFilePath ? (
					<span
						className="text-foreground/70 min-w-0 flex-shrink overflow-hidden text-ellipsis whitespace-nowrap"
						dir="rtl"
						title={singleFilePath}
					>
						{`\u2066${singleFilePath}\u2069`}
					</span>
				) : (
					<span className="text-foreground/70 flex-shrink-0">
						{files} {files === 1 ? 'file' : 'files'}
					</span>
				)}
				<span className="text-emerald-600 dark:text-emerald-400 flex-shrink-0">
					+{additions}
				</span>
				<span className="text-red-600 dark:text-red-400 flex-shrink-0">
					-{deletions}
				</span>
				<span className="text-muted-foreground/80 flex-shrink-0">
					· {timeStr}
				</span>
			</button>
			{isExpanded && hasError && errorMessage && (
				<div>
					<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
					{patch && (
						<div className="mt-2 ml-5">
							<details>
								<summary className="cursor-pointer text-xs text-red-700 dark:text-red-300 hover:text-red-600 dark:hover:text-red-200">
									Show patch that failed
								</summary>
								<div className="mt-2">
									<DiffView patch={patch} />
								</div>
							</details>
						</div>
					)}
				</div>
			)}
			{isExpanded && !hasError && changes.length > 0 && (
				<div className="mt-2 ml-5 space-y-2">
					{changes.map((change) => (
						<div
							key={`apply-patch-${change.filePath}-${change.kind}`}
							className="space-y-1"
						>
							<div className="font-mono text-foreground/80">
								{change.filePath}
							</div>
							<div className="flex flex-wrap gap-2">
								{change.hunks.map((hunk, index) => (
									<span
										key={`apply-patch-${change.filePath}-hunk-${index}`}
										className="rounded bg-muted px-2 py-0.5 text-[0.65rem] font-mono text-muted-foreground"
									>
										{formatHunkLabel(hunk)}
									</span>
								))}
							</div>
						</div>
					))}
				</div>
			)}

			{isExpanded && !hasError && patch && (
				<div className="mt-2 ml-5">
					<DiffView patch={patch} />
				</div>
			)}
		</div>
	);
}
