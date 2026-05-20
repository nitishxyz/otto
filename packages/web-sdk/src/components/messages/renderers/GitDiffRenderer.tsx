import { GitBranch } from 'lucide-react';
import type { RendererProps } from './types';
import { DiffView } from './DiffView';
import { formatDuration, isToolError, getErrorMessage } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderDetail,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolHeaderError,
	ToolContentBox,
} from './shared';

export function GitDiffRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
}: RendererProps) {
	const result = contentJson.result || {};
	const args = contentJson.args || {};
	const patch = String(result.patch || result.diff || '');
	const all = args.all || result.all;
	const timeStr = formatDuration(toolDurationMs);

	const hasError = isToolError(result) || !!contentJson.error;
	const errorMessage =
		getErrorMessage(result) ||
		(typeof contentJson.error === 'string' ? contentJson.error : null);
	const errorStack =
		result && typeof result === 'object' && 'stack' in result
			? String(result.stack)
			: undefined;

	const lines = patch.split('\n');
	let files = 0;
	let additions = 0;
	let deletions = 0;
	for (const line of lines) {
		if (line.startsWith('diff --git')) files += 1;
		else if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
		else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
	}

	const hasChanges = files > 0;

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="git diff"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="purple"
				canExpand={true}
			>
				{all && (
					<>
						<ToolHeaderSeparator />
						<span className="text-muted-foreground/60">(all)</span>
					</>
				)}
				<ToolHeaderSeparator />
				{hasChanges ? (
					<>
						<ToolHeaderDetail>
							{files} {files === 1 ? 'file' : 'files'}
						</ToolHeaderDetail>
						{additions > 0 && (
							<>
								<ToolHeaderSeparator />
								<ToolHeaderSuccess>+{additions}</ToolHeaderSuccess>
							</>
						)}
						{deletions > 0 && (
							<>
								<ToolHeaderSeparator />
								<ToolHeaderError>-{deletions}</ToolHeaderError>
							</>
						)}
					</>
				) : (
					<span className="text-muted-foreground/60">no changes</span>
				)}
				<ToolHeaderSeparator />
				<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
			</ToolHeader>

			{isExpanded && hasError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
			)}

			{isExpanded && !hasError && (
				<div className="mt-2 ml-5 flex flex-col gap-2 max-w-full">
					<ToolContentBox
						title="options"
						icon={<GitBranch className="h-3 w-3" />}
						maxHeight=""
					>
						<div className="px-3 py-2 font-mono text-xs bg-muted/10">
							{all ? 'git diff (all working tree)' : 'git diff (staged only)'}
						</div>
					</ToolContentBox>

					{patch && <DiffView patch={patch} />}

					{!patch && (
						<ToolContentBox title="diff" maxHeight="">
							<div className="px-3 py-2 text-muted-foreground/60 italic">
								No changes to show
							</div>
						</ToolContentBox>
					)}
				</div>
			)}
		</div>
	);
}
