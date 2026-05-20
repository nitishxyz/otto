import { File, Folder, FolderOpen } from 'lucide-react';
import type { RendererProps } from './types';
import { formatDuration, isToolError, getErrorMessage } from './utils';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderDetail,
	ToolHeaderMeta,
	ToolContentBox,
} from './shared';
import { ToolErrorDisplay } from './ToolErrorDisplay';

export function ListRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
}: RendererProps) {
	const result = contentJson.result || {};
	const args = (contentJson.args || {}) as Record<string, unknown>;
	const hasError = isToolError(result);
	const errorMessage = getErrorMessage(result);
	const errorStack =
		result && typeof result === 'object' && 'stack' in result
			? String(result.stack)
			: undefined;
	const entries = (result.entries as Array<unknown>) || [];
	const timeStr = formatDuration(toolDurationMs);

	const path = typeof args.path === 'string' ? args.path : '.';

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="ls"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="cyan"
				canExpand={true}
			>
				{path && path !== '.' && (
					<>
						<ToolHeaderSeparator />
						<span className="text-foreground/70 truncate min-w-0" title={path}>
							{path.length > 30 ? `…${path.slice(-30)}` : path}
						</span>
					</>
				)}
				<ToolHeaderSeparator />
				<ToolHeaderDetail>
					{entries.length} {entries.length === 1 ? 'entry' : 'entries'}
				</ToolHeaderDetail>
				<ToolHeaderSeparator />
				<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
			</ToolHeader>

			{isExpanded && hasError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
			)}

			{isExpanded && !hasError && (
				<div className="mt-2 ml-5 flex flex-col gap-2 max-w-full">
					<ToolContentBox
						title="path"
						icon={<FolderOpen className="h-3 w-3" />}
						copyText={path}
						maxHeight=""
					>
						<div className="px-3 py-2 font-mono text-xs bg-muted/10 break-all">
							{path}
						</div>
					</ToolContentBox>

					{entries.length > 0 && (
						<ToolContentBox
							title="entries"
							copyText={entries
								.map((e) => {
									const entry = e as { name?: string };
									return entry.name || '';
								})
								.join('\n')}
							maxHeight="max-h-80"
						>
							<div className="divide-y divide-border/50">
								{entries.map((entry, i) => {
									const e = entry as {
										name?: string;
										type?: string;
										isDirectory?: boolean;
									};
									const isDir = e.type === 'dir' || e.isDirectory;
									return (
										<div
											key={`${e.name}-${i}`}
											className="flex items-center gap-1.5 px-3 py-1 font-mono text-foreground/80 hover:bg-muted/20"
										>
											{isDir ? (
												<Folder className="h-3 w-3 text-blue-500 flex-shrink-0" />
											) : (
												<File className="h-3 w-3 text-muted-foreground flex-shrink-0" />
											)}
											<span className="truncate">{e.name}</span>
										</div>
									);
								})}
							</div>
						</ToolContentBox>
					)}

					{entries.length === 0 && (
						<ToolContentBox title="entries" maxHeight="">
							<div className="px-3 py-2 text-muted-foreground/60 italic">
								Directory is empty
							</div>
						</ToolContentBox>
					)}
				</div>
			)}
		</div>
	);
}
