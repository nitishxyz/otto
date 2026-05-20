import {
	ChevronRight,
	AlertCircle,
	BookOpen,
	FileText,
	ShieldAlert,
} from 'lucide-react';
import type { RendererProps } from './types';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';

interface SkillFileInfo {
	relativePath: string;
	size: number;
}

interface SecurityNotice {
	type: string;
	description: string;
	line?: number;
}

export function SkillRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: RendererProps) {
	const result = contentJson.result || {};
	const timeStr = formatDuration(toolDurationMs);

	const hasToolError =
		typeof result === 'object' && 'ok' in result && result.ok === false;
	const errorMessage =
		hasToolError && 'error' in result && typeof result.error === 'string'
			? result.error
			: null;

	const name = (result as Record<string, unknown>).name as string | undefined;
	const description = (result as Record<string, unknown>).description as
		| string
		| undefined;
	const content = (result as Record<string, unknown>).content as
		| string
		| undefined;
	const scope = (result as Record<string, unknown>).scope as string | undefined;
	const availableFiles = (result as Record<string, unknown>).availableFiles as
		| SkillFileInfo[]
		| undefined;
	const securityNotices = (result as Record<string, unknown>).securityNotices as
		| SecurityNotice[]
		| undefined;

	const isSubFile = description?.startsWith('Sub-file:');
	const fileCount = availableFiles?.length ?? 0;
	const noticeCount = securityNotices?.length ?? 0;
	const canExpand = !!content || hasToolError;

	return (
		<div className="text-[12px]">
			<button
				type="button"
				onClick={() => canExpand && onToggle()}
				className={`flex items-center gap-2 transition-colors w-full min-w-0 ${
					hasToolError
						? 'text-red-700 dark:text-red-300 hover:text-red-600 dark:hover:text-red-200'
						: canExpand
							? 'text-violet-700 dark:text-violet-300 hover:text-violet-600 dark:hover:text-violet-200'
							: 'text-violet-700 dark:text-violet-300'
				}`}
			>
				{canExpand ? (
					<ChevronRight
						className={`h-3 w-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
					/>
				) : (
					<div className="w-3 flex-shrink-0" />
				)}
				{hasToolError && (
					<AlertCircle className="h-3 w-3 flex-shrink-0 text-red-600 dark:text-red-400" />
				)}
				{isSubFile ? (
					<FileText className="h-3 w-3 flex-shrink-0" />
				) : (
					<BookOpen className="h-3 w-3 flex-shrink-0" />
				)}
				<span className="font-medium flex-shrink-0">
					skill{hasToolError ? ' error' : ''}
				</span>
				{name && !compact && (
					<>
						<span className="text-muted-foreground/70 flex-shrink-0">·</span>
						<span className="text-foreground/70 truncate">
							{isSubFile ? description?.replace('Sub-file: ', '') : name}
						</span>
					</>
				)}
				{scope && !compact && !isSubFile && (
					<span className="text-muted-foreground/80 flex-shrink-0">
						· {scope}
					</span>
				)}
				{fileCount > 0 && !compact && (
					<span className="text-muted-foreground/80 flex-shrink-0">
						· {fileCount} file{fileCount !== 1 ? 's' : ''}
					</span>
				)}
				{noticeCount > 0 && !compact && (
					<span className="text-amber-600 dark:text-amber-400 flex-shrink-0 flex items-center gap-0.5">
						· <ShieldAlert className="h-3 w-3 inline" /> {noticeCount}
					</span>
				)}
				{timeStr && !compact && (
					<span className="text-muted-foreground/80 flex-shrink-0">
						· {timeStr}
					</span>
				)}
			</button>
			{isExpanded && hasToolError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} />
			)}
			{isExpanded && !hasToolError && (
				<div className="mt-2 ml-5 space-y-2">
					{noticeCount > 0 && securityNotices && (
						<div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 space-y-1">
							<div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-medium text-[11px]">
								<ShieldAlert className="h-3 w-3" />
								Security Notice{noticeCount > 1 ? 's' : ''}
							</div>
							{securityNotices.map((notice, i) => (
								<div
									key={`${notice.type}-${notice.line ?? i}`}
									className="text-amber-600 dark:text-amber-400 text-[11px] leading-snug"
								>
									<span className="font-mono bg-amber-100 dark:bg-amber-900/40 rounded px-1 py-0.5">
										{notice.type}
									</span>{' '}
									{notice.description}
								</div>
							))}
						</div>
					)}
					{description && !isSubFile && (
						<p className="text-muted-foreground italic">{description}</p>
					)}
					{content && (
						<div className="bg-card/60 border border-border rounded-lg overflow-hidden max-h-96 overflow-y-auto max-w-full">
							<div className="p-3 whitespace-pre-wrap font-mono text-xs leading-relaxed">
								{content}
							</div>
						</div>
					)}
					{fileCount > 0 && availableFiles && (
						<details className="group">
							<summary className="text-muted-foreground cursor-pointer hover:text-foreground/80 text-[11px] select-none">
								{fileCount} available sub-file{fileCount !== 1 ? 's' : ''}
							</summary>
							<div className="mt-1.5 bg-card/40 border border-border rounded-lg p-2 space-y-0.5 max-h-48 overflow-y-auto">
								{availableFiles.map((f) => (
									<div
										key={f.relativePath}
										className="flex items-center justify-between gap-2 font-mono text-[11px]"
									>
										<span className="text-foreground/80 truncate">
											{f.relativePath}
										</span>
										<span className="text-muted-foreground/60 flex-shrink-0 tabular-nums">
											{formatFileSize(f.size)}
										</span>
									</div>
								))}
							</div>
						</details>
					)}
				</div>
			)}
		</div>
	);
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(1)}KB`;
	return `${(kb / 1024).toFixed(1)}MB`;
}
