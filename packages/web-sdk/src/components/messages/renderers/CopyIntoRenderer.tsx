import { ArrowRight, ChevronRight } from 'lucide-react';
import type { GenericRendererProps } from './types';
import { DiffView } from './DiffView';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';

interface CopyIntoChangeHunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	additions: number;
	deletions: number;
	context?: string;
}

interface CopyIntoChange {
	filePath: string;
	kind: string;
	hunks: CopyIntoChangeHunk[];
}

interface CopyIntoArtifact {
	patch?: string;
	summary?: {
		files?: number;
		additions?: number;
		deletions?: number;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isArtifact(value: unknown): value is CopyIntoArtifact {
	return isRecord(value);
}

function getString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	return typeof value === 'string' ? value : '';
}

function getNumber(
	record: Record<string, unknown>,
	key: string,
): number | null {
	const value = record[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatEndpoint(value: unknown): string {
	if (typeof value === 'number') return String(value);
	if (typeof value === 'string') return value;
	return '';
}

function formatSourceRange(
	args: Record<string, unknown>,
	result: Record<string, unknown>,
): string {
	const resultRange = getString(result, 'sourceRange');
	if (resultRange) return resultRange;
	const start = formatEndpoint(args.startLine);
	const end = formatEndpoint(args.endLine);
	return start && end ? `${start}-${end}` : '';
}

function formatTargetRange(
	args: Record<string, unknown>,
	result: Record<string, unknown>,
): string {
	const resultRange = getString(result, 'targetRange');
	if (resultRange) return resultRange;
	const mode = getString(args, 'mode') || 'insert_before';
	if (mode === 'replace_range') {
		const start = formatEndpoint(args.targetStartLine);
		const end = formatEndpoint(args.targetEndLine);
		return start && end ? `${start}-${end}` : '';
	}
	return formatEndpoint(args.insertAtLine);
}

export function CopyIntoRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
}: GenericRendererProps) {
	const result = isRecord(contentJson.result) ? contentJson.result : {};
	const args = isRecord(contentJson.args) ? contentJson.args : {};
	const nestedArtifact = result.artifact;
	const artifact =
		contentJson.artifact ??
		(isArtifact(nestedArtifact) ? nestedArtifact : undefined);
	const summary = artifact?.summary || {};
	const additions = Number(summary.additions || 0);
	const deletions = Number(summary.deletions || 0);
	const patch = artifact?.patch ? String(artifact.patch) : '';
	const timeStr = formatDuration(toolDurationMs);

	const sourcePath =
		getString(result, 'sourcePath') || getString(args, 'sourcePath');
	const targetPath =
		getString(result, 'targetPath') || getString(args, 'targetPath');
	const sourceRange = formatSourceRange(args, result);
	const targetRange = formatTargetRange(args, result);
	const mode =
		getString(result, 'mode') || getString(args, 'mode') || 'insert_before';
	const linesCopied = getNumber(result, 'linesCopied');

	const changes = Array.isArray(contentJson.result?.changes)
		? (contentJson.result?.changes as CopyIntoChange[])
		: [];

	const formatSpan = (start: number, count: number) => {
		if (count <= 1) return `${start}`;
		return `${start}-${start + count - 1}`;
	};

	const formatHunkLabel = (hunk: CopyIntoChangeHunk) => {
		const left = `-${formatSpan(hunk.oldStart, hunk.oldLines)}`;
		const right = `+${formatSpan(hunk.newStart, hunk.newLines)}`;
		const deltaParts: string[] = [];
		if (hunk.additions > 0) deltaParts.push(`+${hunk.additions}`);
		if (hunk.deletions > 0) deltaParts.push(`-${hunk.deletions}`);
		const delta = deltaParts.length > 0 ? ` (${deltaParts.join(', ')})` : '';
		return `${left} ${right}${delta}`;
	};

	const hasError = Boolean(contentJson.error) || result.ok === false;
	const errorMessage =
		typeof contentJson.error === 'string'
			? contentJson.error
			: typeof result.error === 'string'
				? result.error
				: null;
	const errorStack =
		typeof result.stack === 'string' ? result.stack : undefined;
	const title = [sourcePath, targetPath].filter(Boolean).join(' → ');

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
				title={title || undefined}
			>
				<ChevronRight
					className={`h-3 w-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
				/>
				<span className="font-medium flex-shrink-0">
					copy into{hasError ? ' error' : ''}
				</span>
				<span className="text-muted-foreground/70 flex-shrink-0">·</span>
				<span className="min-w-0 flex items-center gap-1.5 text-foreground/70">
					<span className="min-w-0 truncate font-mono" title={sourcePath}>
						{sourcePath || 'source'}
						{sourceRange ? `:${sourceRange}` : ''}
					</span>
					<ArrowRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" />
					<span className="min-w-0 truncate font-mono" title={targetPath}>
						{targetPath || 'target'}
						{targetRange ? `:${targetRange}` : ''}
					</span>
				</span>
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

			{isExpanded && (sourcePath || targetPath || linesCopied !== null) && (
				<div className="mt-2 ml-5 grid gap-1 rounded-md bg-muted/40 p-2 font-mono text-[0.7rem] text-foreground/80">
					{sourcePath && (
						<div className="min-w-0 truncate">
							<span className="text-muted-foreground">source:</span>{' '}
							{sourcePath}
							{sourceRange ? `:${sourceRange}` : ''}
						</div>
					)}
					{targetPath && (
						<div className="min-w-0 truncate">
							<span className="text-muted-foreground">target:</span>{' '}
							{targetPath}
							{targetRange ? `:${targetRange}` : ''}
						</div>
					)}
					<div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
						<span>mode: {mode}</span>
						{linesCopied !== null && <span>lines copied: {linesCopied}</span>}
					</div>
				</div>
			)}

			{isExpanded && hasError && errorMessage && (
				<div className="mt-2">
					<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
				</div>
			)}

			{isExpanded && !hasError && changes.length > 0 && (
				<div className="mt-2 ml-5 space-y-2">
					{changes.map((change) => (
						<div
							key={`copy-into-${change.filePath}-${change.kind}`}
							className="space-y-1"
						>
							<div className="font-mono text-foreground/80">
								{change.filePath}
							</div>
							<div className="flex flex-wrap gap-2">
								{change.hunks.map((hunk, index) => (
									<span
										key={`copy-into-${change.filePath}-hunk-${index}`}
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
