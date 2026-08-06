import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import type { GenericRendererProps } from './types';
import { DiffView } from './DiffView';
import { InlinePatchDiff } from '../../diff/InlineDiff';
import {
	normalizeToolPatch,
	summarizePatchFiles,
} from '../../diff/patchNormalize';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import { InlineChangeCount } from '../../workspace/ViewerStatusBar';

interface ApplyPatchChange {
	filePath: string;
	kind: string;
	hunks: unknown[];
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

	const summary = artifact?.summary || {};
	const patch = artifact?.patch ? String(artifact.patch) : '';

	const changes = Array.isArray(contentJson.result?.changes)
		? (contentJson.result?.changes as ApplyPatchChange[])
		: [];

	// One apply_patch call may touch several files; parse them all so the
	// summary counts and the rendered sections come from the same model.
	const parsedFiles = useMemo(() => normalizeToolPatch(patch), [patch]);
	const parsedTotals = useMemo(
		() => summarizePatchFiles(parsedFiles),
		[parsedFiles],
	);

	const files = Number(summary.files || 0) || parsedTotals.files;
	const additions = Number(summary.additions ?? parsedTotals.additions);
	const deletions = Number(summary.deletions ?? parsedTotals.deletions);

	const rendererToolName = toolName || contentJson.name || 'apply_patch';
	const titleLabel = rendererToolName.replace(/_/g, ' ');

	const firstPath =
		parsedFiles[0]?.path ||
		changes[0]?.filePath ||
		(typeof contentJson.result?.path === 'string'
			? contentJson.result.path
			: typeof contentJson.args?.path === 'string'
				? contentJson.args.path
				: null);
	const singleFilePath = files === 1 ? firstPath : null;
	// Multi-file calls show the first path plus a remaining-file count.
	const extraFileCount = Math.max(0, files - 1);

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
				{firstPath ? (
					<>
						<span
							className="text-foreground/70 min-w-0 flex-shrink overflow-hidden text-ellipsis whitespace-nowrap"
							dir="rtl"
							title={firstPath}
						>
							{`\u2066${firstPath}\u2069`}
						</span>
						{extraFileCount > 0 && (
							<span className="text-muted-foreground/80 flex-shrink-0 whitespace-nowrap">
								+{extraFileCount} file{extraFileCount === 1 ? '' : 's'}
							</span>
						)}
					</>
				) : (
					<span className="text-foreground/70 flex-shrink-0">
						{files} {files === 1 ? 'file' : 'files'}
					</span>
				)}
				<InlineChangeCount
					count={{ additions, removals: deletions }}
					className="text-[12px] flex-shrink-0"
				/>
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
								<div className="mt-2 min-w-0">
									<DiffView
										patch={patch}
										filePath={singleFilePath ?? undefined}
									/>
								</div>
							</details>
						</div>
					)}
				</div>
			)}
			{/*
			 * Each file's path row, hunk chips and diff render together as one
			 * section, so a file can never show chips with no code beneath them.
			 */}
			{isExpanded && !hasError && patch && (
				<div className="mt-2 ml-5 min-w-0">
					<InlinePatchDiff
						patch={patch}
						fallbackPath={singleFilePath ?? undefined}
						hidePathHeader={Boolean(singleFilePath)}
					/>
				</div>
			)}
		</div>
	);
}
