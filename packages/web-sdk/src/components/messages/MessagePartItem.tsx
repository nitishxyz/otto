import {
	Sparkles,
	GitBranch,
	Diff,
	GitCommit,
	Check,
	Terminal,
	FileText,
	FileEdit,
	Search,
	FolderTree,
	List,
	AlertCircle,
	XOctagon,
	Brain,
	Database,
	Plug,
	BookOpen,
} from 'lucide-react';
import {
	Fragment,
	memo,
	type ReactNode,
	type ComponentPropsWithoutRef,
} from 'react';
import type { PendingToolApproval } from '../../stores/toolApprovalStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolApprovalCard } from './ToolApprovalCard';
import type { MessagePart } from '../../types/api';
import { StableSpinner } from '../ui/StableSpinner';
import {
	ToolResultRenderer,
	ReasoningRenderer,
	type ContentJson,
} from './renderers';
import { CopyButton } from './renderers/shared';
import { useIsCompactThread } from './threadDensity';

function getToolCallPayload(part: MessagePart): Record<string, unknown> | null {
	const fromJson = part.contentJson;
	if (fromJson && typeof fromJson === 'object') {
		return fromJson;
	}
	try {
		if (part.content) {
			const parsed = JSON.parse(part.content);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		}
	} catch {}
	return null;
}

function getToolCallArgs(
	part: MessagePart,
): Record<string, unknown> | undefined {
	const payload = getToolCallPayload(part);
	if (!payload) return undefined;

	const args = (payload as { args?: unknown }).args;
	if (args && typeof args === 'object' && !Array.isArray(args)) {
		return args as Record<string, unknown>;
	}

	return undefined;
}

function getPrimaryCommand(
	args: Record<string, unknown> | undefined,
): string | null {
	if (!args) return null;
	const candidates = ['cmd', 'command', 'script', 'input'];
	for (const key of candidates) {
		const value = args[key];
		if (typeof value === 'string' && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
}

function getPatchedFileFromPatch(patch: string): string | null {
	const match = patch.match(
		/^\*\*\*\s+(?:Update|Add|Delete|Replace in):\s+(.+)$/m,
	);
	return match?.[1]?.trim() || null;
}

function normalizeToolName(toolName: string): string {
	return toolName === 'bash' ? 'shell' : toolName;
}

function isShellTool(toolName: string): boolean {
	return normalizeToolName(toolName) === 'shell';
}

function isTodoTool(toolName: string | null | undefined): boolean {
	return (
		toolName === 'update_todos' ||
		toolName === 'update_plan' ||
		toolName === 'UpdateTodos' ||
		toolName === 'UpdatePlan'
	);
}

function normalizeToolTarget(
	toolName: string,
	args: Record<string, unknown> | undefined,
): { key: string; value: string } | null {
	if (!args) return null;
	const candidates = [
		{ key: 'path', match: true },
		{ key: 'file', match: true },
		{ key: 'target', match: true },
		{ key: 'cwd', match: true },
		{ key: 'query', match: true },
		{ key: 'pattern', match: true },
		{ key: 'glob', match: true },
		{ key: 'dir', match: true },
	];
	for (const { key } of candidates) {
		const value = args[key];
		if (typeof value === 'string' && value.trim().length > 0) {
			return { key, value: value.trim() };
		}
	}
	if (isShellTool(toolName)) {
		const command = args.command;
		if (typeof command === 'string' && command.trim().length > 0) {
			return { key: 'command', value: command.trim() };
		}
	}
	if (toolName === 'apply_patch') {
		const patch = args.patch;
		if (typeof patch === 'string' && patch.trim().length > 0) {
			const target = getPatchedFileFromPatch(patch);
			if (target) {
				return { key: 'patch', value: target };
			}
		}
	}
	return null;
}

function formatArgsPreview(
	args: Record<string, unknown> | undefined,
	skipKey?: string,
): string | null {
	if (!args) return null;
	const pieces: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		if (skipKey && key === skipKey) continue;
		if (typeof value === 'string' || typeof value === 'number') {
			const rendered = `${key}=${String(value)}`;
			pieces.push(rendered);
		}
		if (pieces.length >= 3) break;
	}
	if (!pieces.length) return null;
	const joined = pieces.join('  ');
	return joined.length > 120 ? `${joined.slice(0, 117)}…` : joined;
}

interface MessagePartItemProps {
	part: MessagePart;
	showLine: boolean;
	isFirstPart: boolean;
	isLastToolCall?: boolean;
	isLastProgressUpdate?: boolean;
	onNavigateToSession?: (sessionId: string) => void;
	compact?: boolean;
	pendingApproval?: PendingToolApproval | null;
	onApprove?: (callId: string) => void;
	onReject?: (callId: string) => void;
	sessionId?: string;
	onRetry?: () => void;
	onCompact?: () => void;
}

export const MessagePartItem = memo(
	function MessagePartItem({
		part,
		showLine,
		isLastToolCall,
		isLastProgressUpdate,
		onNavigateToSession,
		compact,
		pendingApproval,
		onApprove,
		onReject,
		sessionId,
		onRetry,
		onCompact,
	}: MessagePartItemProps) {
		const isCompactDensity = useIsCompactThread();
		const isCompactThread = Boolean(compact || isCompactDensity);
		// Show tool_call if it's the last one OR if it has a pending approval
		// Never show loading indicator for progress_update calls
		if (part.type === 'tool_call') {
			const toolName = part.toolName || '';
			if (toolName === 'progress_update') return null;
			if (!isLastToolCall && !pendingApproval) return null;
		}

		if (
			part.type === 'tool_result' &&
			part.toolName === 'progress_update' &&
			!isLastProgressUpdate
		) {
			return null;
		}

		if (part.type === 'tool_result' && isTodoTool(part.toolName)) {
			return null;
		}

		if (part.type === 'text') {
			const data = part.contentJson || part.content;
			let content = '';
			if (data && typeof data === 'object' && 'text' in data) {
				content = String(data.text);
			} else if (typeof data === 'string') {
				content = data;
			}
			if (!content || !content.trim()) {
				return null;
			}
		}

		if (part.type === 'reasoning') {
			const data = part.contentJson || part.content;
			let content = '';
			if (data && typeof data === 'object' && 'text' in data) {
				content = String(data.text);
			} else if (typeof data === 'string') {
				content = data;
			}
			if (!content || !content.trim()) {
				return null;
			}
		}

		const isToolMessage =
			part.type === 'tool_call' || part.type === 'tool_result';
		const isProgressUpdate =
			part.type === 'tool_result' && part.toolName === 'progress_update';

		const contentClasses = ['flex-1', 'min-w-0', 'max-w-full'];

		if (isProgressUpdate) {
			contentClasses.push('pt-0.5');
		} else if (isToolMessage || part.type === 'reasoning') {
			contentClasses.push(compact ? 'pt-0.5' : 'pt-1');
		} else if (part.type === 'error') {
			contentClasses.push('pt-0.5');
		} else if (part.type === 'text') {
			contentClasses.push('pt-0');
			contentClasses.push('-mt-0.5');
		} else {
			contentClasses.push('pt-0');
		}

		const contentClassName = contentClasses.join(' ');

		const renderIcon = () => {
			if (part.type === 'reasoning') {
				return (
					<Brain className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
				);
			}

			if (part.type === 'tool_call') {
				return (
					<StableSpinner
						className="text-amber-600 dark:text-amber-300"
						title="Running tool"
					/>
				);
			}

			if (part.type === 'error') {
				const payload = getToolCallPayload(part);
				const isAborted = payload?.isAborted === true;
				return isAborted ? (
					<XOctagon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
				) : (
					<AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
				);
			}

			if (part.type === 'tool_result') {
				const toolName = part.toolName || '';
				if (toolName === 'progress_update')
					return (
						<StableSpinner
							className="text-violet-700 dark:text-violet-300"
							title="Assistant is working"
						/>
					);
				if (toolName === 'read')
					return (
						<FileText className="h-4 w-4 text-blue-600 dark:text-blue-300" />
					);
				if (toolName === 'write' || toolName === 'copy_into')
					return (
						<FileEdit className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
					);
				if (toolName === 'ls')
					return <List className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />;
				if (toolName === 'tree')
					return (
						<FolderTree className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
					);
				if (isShellTool(toolName))
					return <Terminal className="h-4 w-4 text-muted-foreground" />;
				if (
					toolName === 'ripgrep' ||
					toolName === 'grep' ||
					toolName === 'glob'
				)
					return (
						<Search className="h-4 w-4 text-amber-600 dark:text-amber-300" />
					);
				if (toolName === 'apply_patch')
					return (
						<Diff className="h-4 w-4 text-purple-600 dark:text-purple-300" />
					);
				if (toolName === 'git_status')
					return (
						<GitBranch className="h-4 w-4 text-blue-600 dark:text-blue-300" />
					);
				if (toolName === 'git_diff')
					return (
						<Diff className="h-4 w-4 text-purple-600 dark:text-purple-300" />
					);
				if (toolName === 'git_commit')
					return (
						<GitCommit className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
					);
				if (toolName === 'finish')
					return (
						<Check className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
					);
				if (
					toolName === 'query_sessions' ||
					toolName === 'query_messages' ||
					toolName === 'search_history' ||
					toolName === 'get_session_context' ||
					toolName === 'get_parent_session'
				)
					return (
						<Database className="h-4 w-4 text-teal-600 dark:text-teal-300" />
					);
				if (toolName === 'terminal')
					return (
						<Terminal className="h-4 w-4 text-amber-600 dark:text-amber-300" />
					);
				if (toolName === 'skill')
					return (
						<BookOpen className="h-4 w-4 text-violet-600 dark:text-violet-300" />
					);
				if (toolName.includes('__'))
					return (
						<Plug className="h-4 w-4 text-purple-600 dark:text-purple-300" />
					);
				return <Terminal className="h-4 w-4 text-muted-foreground" />;
			}

			return (
				<Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-300" />
			);
		};

		const renderToolResult = () => {
			const toolName = part.toolName || '';

			let contentJson: ContentJson;
			try {
				if (part.contentJson && typeof part.contentJson === 'object') {
					contentJson = part.contentJson as ContentJson;
				} else if (typeof part.content === 'string') {
					contentJson = JSON.parse(part.content);
				} else {
					contentJson = {};
				}
			} catch {
				contentJson = { result: part.content } as ContentJson;
			}

			return (
				<ToolResultRenderer
					toolName={toolName}
					contentJson={contentJson}
					toolDurationMs={part.toolDurationMs}
					debug={false}
					onNavigateToSession={onNavigateToSession}
					compact={compact}
				/>
			);
		};

		const renderContent = () => {
			if (part.type === 'reasoning') {
				return <ReasoningRenderer part={part} />;
			}

			if (part.type === 'text') {
				let content = '';
				const data = part.contentJson || part.content;
				if (data && typeof data === 'object' && 'text' in data) {
					content = String(data.text);
				} else if (typeof data === 'string') {
					content = data;
				} else if (data) {
					content = JSON.stringify(data, null, 2);
				}

				return (
					<div className="relative group">
						<div
							className={`${
								isCompactThread ? 'text-[16.5px]' : 'text-[17px]'
							} text-foreground leading-relaxed markdown-content max-w-full overflow-x-auto`}
						>
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								components={{
									a: ({
										href,
										children,
										...props
									}: ComponentPropsWithoutRef<'a'>) => (
										<a
											href={href}
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary underline decoration-primary/35 underline-offset-2 transition-colors hover:text-primary/90 hover:decoration-primary"
											onClick={(e) => {
												if (window.self !== window.top && href) {
													e.preventDefault();
													window.parent.postMessage(
														{
															type: 'otto-open-url',
															url: href,
														},
														'*',
													);
												}
											}}
											{...props}
										>
											{children}
										</a>
									),
									pre: ({
										children,
										...props
									}: ComponentPropsWithoutRef<'pre'>) => {
										const codeContent = (() => {
											if (!children) return '';
											const child = Array.isArray(children)
												? children[0]
												: children;
											if (
												child &&
												typeof child === 'object' &&
												'props' in child
											) {
												const codeProps = child.props as { children?: unknown };
												if (typeof codeProps.children === 'string') {
													return codeProps.children;
												}
											}
											return '';
										})();
										return (
											<div className="relative group/code my-3">
												<div className="absolute top-2 right-2 opacity-0 group-hover/code:opacity-100 transition-opacity z-10">
													<CopyButton
														text={codeContent}
														className="bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm"
														size="sm"
													/>
												</div>
												<pre {...props} className="overflow-x-auto">
													{children}
												</pre>
											</div>
										);
									},
									table: ({
										children,
										...props
									}: ComponentPropsWithoutRef<'table'>) => (
										<div className="overflow-x-auto max-w-full min-w-0 my-3">
											<table {...props}>{children}</table>
										</div>
									),
								}}
							>
								{content}
							</ReactMarkdown>
						</div>
					</div>
				);
			}

			if (part.type === 'error') {
				let contentJson: ContentJson;
				try {
					if (part.contentJson && typeof part.contentJson === 'object') {
						contentJson = part.contentJson as ContentJson;
					} else if (typeof part.content === 'string') {
						contentJson = JSON.parse(part.content);
					} else {
						contentJson = {};
					}
				} catch {
					contentJson = {
						message: part.content || 'Unknown error',
					} as ContentJson;
				}

				return (
					<ToolResultRenderer
						toolName="error"
						contentJson={contentJson}
						toolDurationMs={part.toolDurationMs}
						debug={false}
						compact={compact}
						sessionId={sessionId}
						onRetry={onRetry}
						onCompact={onCompact}
					/>
				);
			}

			if (part.type === 'tool_call') {
				const payload = getToolCallPayload(part);
				const rawToolName =
					part.toolName ||
					(typeof (payload as { name?: unknown })?.name === 'string'
						? ((payload as { name?: unknown }).name as string)
						: 'tool');
				const normalizedToolName = normalizeToolName(rawToolName);
				const toolLabel = normalizedToolName.includes('__')
					? normalizedToolName.replace('__', ' › ')
					: normalizedToolName.replace(/_/g, ' ');
				// Use args from pending approval if available (for early approval display)
				// Fall back to part args for normal tool calls
				const partArgs = getToolCallArgs(part);
				const approvalArgs = pendingApproval?.args as
					| Record<string, unknown>
					| undefined;
				const args = partArgs || approvalArgs;
				const primary = normalizeToolTarget(normalizedToolName, args);
				const argsPreview = formatArgsPreview(args, primary?.key);
				const command = isShellTool(normalizedToolName)
					? getPrimaryCommand(args)
					: null;
				const segments: Array<{ key: string; node: ReactNode }> = [];
				if (command) {
					segments.push({
						key: 'cmd',
						node: (
							<code className="font-mono text-foreground/90 truncate max-w-xs">
								{command}
							</code>
						),
					});
				} else if (primary) {
					segments.push({
						key: 'primary',
						node: (
							<code className="font-mono text-foreground/85 truncate max-w-xs">
								{primary.value}
							</code>
						),
					});
				}
				if (argsPreview) {
					segments.push({
						key: 'args',
						node: (
							<span className="text-muted-foreground/80 truncate max-w-xs">
								{argsPreview}
							</span>
						),
					});
				}

				// Check if this tool call has a pending approval
				const hasPendingApproval =
					pendingApproval && pendingApproval.callId === part.toolCallId;

				if (hasPendingApproval && onApprove && onReject) {
					return (
						<ToolApprovalCard
							toolName={rawToolName}
							args={args}
							pendingApproval={pendingApproval}
							onApprove={onApprove}
							onReject={onReject}
						/>
					);
				} else if (segments.length === 0) {
					segments.push({
						key: 'running',
						node: <span className="text-muted-foreground/75">running…</span>,
					});
				}

				const containerClasses = [
					`flex flex-wrap items-center gap-x-2 gap-y-1 ${
						isCompactThread ? 'text-[13px]' : 'text-[14px]'
					} text-foreground/80 max-w-full`,
				];
				if (part.ephemeral) containerClasses.push('animate-pulse');
				return (
					<div className={containerClasses.join(' ')}>
						<span className="font-medium text-foreground">{toolLabel}</span>
						{segments.map((segment) => (
							<Fragment key={segment.key}>
								<span className="text-muted-foreground/65">·</span>
								{segment.node}
							</Fragment>
						))}
					</div>
				);
			}

			if (part.type === 'tool_result') {
				return renderToolResult();
			}

			return null;
		};

		return (
			<div
				className={`flex ${isCompactThread ? 'gap-1.5' : 'gap-3'} pb-2 relative max-w-full overflow-hidden`}
			>
				<div
					className={`flex-shrink-0 ${isCompactThread ? 'w-4' : 'w-6'} flex items-start justify-center relative pt-0.5`}
				>
					<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative bg-background">
						{renderIcon()}
					</div>
					{showLine && (
						<div
							className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-border z-0"
							style={{ top: '1.25rem', bottom: '-0.5rem' }}
						/>
					)}
				</div>

				<div className={contentClassName}>{renderContent()}</div>
			</div>
		);
	},
	(prevProps, nextProps) => {
		return (
			prevProps.part.id === nextProps.part.id &&
			prevProps.part.content === nextProps.part.content &&
			prevProps.part.ephemeral === nextProps.part.ephemeral &&
			prevProps.part.completedAt === nextProps.part.completedAt &&
			prevProps.showLine === nextProps.showLine &&
			prevProps.isLastToolCall === nextProps.isLastToolCall &&
			prevProps.isLastProgressUpdate === nextProps.isLastProgressUpdate &&
			prevProps.compact === nextProps.compact &&
			prevProps.onNavigateToSession === nextProps.onNavigateToSession &&
			prevProps.pendingApproval?.callId === nextProps.pendingApproval?.callId &&
			prevProps.onApprove === nextProps.onApprove &&
			prevProps.onReject === nextProps.onReject
		);
	},
);
