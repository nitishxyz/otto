import { ExternalLink, Link2, Search, Filter } from 'lucide-react';
import type { RendererProps } from './types';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolHeaderError,
	ToolContentBox,
} from './shared';

interface SessionResult {
	id: string;
	title?: string | null;
	agent?: string;
	provider?: string;
	model?: string;
	createdAt?: number;
	lastActiveAt?: number;
	messageCount?: number;
	sessionType?: string;
}

interface MessageResult {
	id: string;
	sessionId: string;
	sessionTitle?: string | null;
	role?: string;
	content?: string;
	contentPreview?: string;
	createdAt?: number;
}

interface SearchResult {
	sessionId: string;
	sessionTitle?: string | null;
	messageId: string;
	role?: string;
	matchedContent?: string;
	createdAt?: number;
}

interface SessionLinkItem {
	sessionId: string;
	title: string;
	description?: string;
}

interface DatabaseToolRendererProps extends RendererProps {
	toolName: string;
	onNavigateToSession?: (sessionId: string) => void;
}

function formatDate(timestamp?: number): string {
	if (!timestamp) return '';
	const date = new Date(timestamp);
	return date.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function SessionLink({
	session,
	onNavigate,
	compact,
}: {
	session: SessionResult;
	onNavigate?: (id: string) => void;
	compact?: boolean;
}) {
	if (compact) {
		return (
			<button
				type="button"
				onClick={() => onNavigate?.(session.id)}
				disabled={!onNavigate}
				className="w-full text-left py-1 px-2 rounded text-xs hover:bg-muted/50 transition-colors flex items-center justify-between gap-2"
			>
				<span className="truncate text-foreground">
					{session.title || 'Untitled'}
				</span>
				{onNavigate && (
					<ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
				)}
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={() => onNavigate?.(session.id)}
			disabled={!onNavigate}
			className="w-full text-left p-2 rounded-md border border-border hover:bg-muted/50 transition-colors group"
		>
			<div className="flex items-center justify-between gap-2">
				<span className="font-medium text-sm truncate text-foreground">
					{session.title || 'Untitled'}
				</span>
				{onNavigate && (
					<ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
				)}
			</div>
			<div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
				{session.agent && (
					<span className="text-violet-600 dark:text-violet-400">
						{session.agent}
					</span>
				)}
				{session.agent && session.provider && <span>·</span>}
				{session.provider && <span>{session.provider}</span>}
				{session.messageCount !== undefined && (
					<>
						<span>·</span>
						<span>{session.messageCount} msgs</span>
					</>
				)}
				{session.createdAt && (
					<>
						<span>·</span>
						<span>{formatDate(session.createdAt)}</span>
					</>
				)}
			</div>
		</button>
	);
}

function MessageLink({
	message,
	onNavigate,
	compact,
}: {
	message: MessageResult | SearchResult;
	onNavigate?: (sessionId: string) => void;
	compact?: boolean;
}) {
	const sessionId = 'sessionId' in message ? message.sessionId : '';
	const sessionTitle = 'sessionTitle' in message ? message.sessionTitle : null;
	const content =
		'content' in message
			? message.content
			: 'contentPreview' in message
				? message.contentPreview
				: 'matchedContent' in message
					? message.matchedContent
					: '';

	if (compact) {
		return (
			<button
				type="button"
				onClick={() => onNavigate?.(sessionId)}
				disabled={!onNavigate || !sessionId}
				className="w-full text-left py-1 px-2 rounded text-xs hover:bg-muted/50 transition-colors flex items-center justify-between gap-2"
			>
				<span className="truncate text-foreground/80">
					{content?.slice(0, 50) || sessionTitle || sessionId.slice(0, 8)}
				</span>
				{onNavigate && sessionId && (
					<ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
				)}
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={() => onNavigate?.(sessionId)}
			disabled={!onNavigate || !sessionId}
			className="w-full text-left p-2 rounded-md border border-border hover:bg-muted/50 transition-colors group"
		>
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs text-muted-foreground">
					{sessionTitle || sessionId.slice(0, 8)}
				</span>
				{onNavigate && sessionId && (
					<ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
				)}
			</div>
			{content && (
				<div className="text-xs text-foreground/80 mt-1 line-clamp-2">
					{content}
				</div>
			)}
			<div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
				{message.role && <span className="capitalize">{message.role}</span>}
				{message.createdAt && (
					<>
						<span>·</span>
						<span>{formatDate(message.createdAt)}</span>
					</>
				)}
			</div>
		</button>
	);
}

function ArgsPreview({
	args,
	toolName,
}: {
	args: Record<string, unknown>;
	toolName: string;
}) {
	const renderArg = (key: string, value: unknown) => {
		if (value === undefined || value === null) return null;
		if (typeof value === 'boolean' && !value) return null;
		if (Array.isArray(value) && value.length === 0) return null;

		return (
			<span
				key={key}
				className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
			>
				<span className="opacity-60">{key}:</span>
				<span className="text-foreground/80">
					{typeof value === 'string' ? value : JSON.stringify(value)}
				</span>
			</span>
		);
	};

	const importantArgs: Record<string, string[]> = {
		query_sessions: ['agent', 'sessionType', 'startDate', 'endDate'],
		query_messages: ['sessionId', 'role', 'search', 'toolName'],
		search_history: ['query'],
		get_session_context: ['sessionId', 'includeMessages'],
		get_parent_session: ['includeMessages'],
	};

	const keysToShow = importantArgs[toolName] || Object.keys(args).slice(0, 3);
	const argsToRender = keysToShow
		.filter((k) => args[k] !== undefined && args[k] !== null)
		.map((k) => renderArg(k, args[k]))
		.filter(Boolean);

	if (argsToRender.length === 0) return null;

	return (
		<div className="flex items-center gap-1.5 flex-wrap text-xs mb-2 pb-2 border-b border-border">
			<Filter className="w-3 h-3 text-muted-foreground flex-shrink-0" />
			{argsToRender}
		</div>
	);
}

export function DatabaseToolRenderer({
	toolName,
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	onNavigateToSession,
	compact,
}: DatabaseToolRendererProps) {
	const result = contentJson.result || {};
	const args = (contentJson.args || {}) as Record<string, unknown>;

	const hasToolError =
		typeof result === 'object' && 'ok' in result && result.ok === false;
	const errorMessage =
		hasToolError && 'error' in result && typeof result.error === 'string'
			? result.error
			: null;

	const timeStr = formatDuration(toolDurationMs);

	if (toolName === 'present_action') {
		const links = (result as { links?: SessionLinkItem[] }).links || [];
		const summary = (result as { summary?: string }).summary;
		const title = (result as { title?: string }).title;

		if (links.length === 0 && !summary) return null;

		return (
			<div className="mt-2 mb-1">
				{title && (
					<div className="text-sm font-medium text-foreground mb-1.5">
						{title}
					</div>
				)}
				{summary && (
					<div className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
						<Link2 className="w-3.5 h-3.5 text-teal-500" />
						<span>{summary}</span>
					</div>
				)}
				{links.length > 0 && (
					<div className="space-y-1.5">
						{links.map((link) => (
							<button
								type="button"
								key={link.sessionId}
								onClick={() => onNavigateToSession?.(link.sessionId)}
								disabled={!onNavigateToSession}
								className="w-full text-left px-3 py-2 rounded-lg border border-teal-500/30 bg-teal-500/5 hover:bg-teal-500/10 transition-colors group flex items-center justify-between gap-2"
							>
								<div>
									<div className="font-medium text-sm text-foreground">
										{link.title}
									</div>
									{link.description && (
										<div className="text-xs text-muted-foreground mt-0.5">
											{link.description}
										</div>
									)}
								</div>
								{onNavigateToSession && (
									<ExternalLink className="w-4 h-4 text-teal-600 dark:text-teal-400 opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0" />
								)}
							</button>
						))}
					</div>
				)}
			</div>
		);
	}

	const getDescription = () => {
		switch (toolName) {
			case 'query_sessions': {
				const sessions =
					(result as { sessions?: SessionResult[] }).sessions || [];
				const total = (result as { total?: number }).total;
				return `${sessions.length} session${sessions.length !== 1 ? 's' : ''}${total ? ` of ${total}` : ''}`;
			}
			case 'query_messages': {
				const messages =
					(result as { messages?: MessageResult[] }).messages || [];
				return `${messages.length} message${messages.length !== 1 ? 's' : ''}`;
			}
			case 'search_history': {
				const query = args.query as string | undefined;
				const results = (result as { results?: SearchResult[] }).results || [];
				const queryPreview = query
					? `"${query.slice(0, 20)}${query.length > 20 ? '…' : ''}"`
					: '';
				return `${results.length} result${results.length !== 1 ? 's' : ''}${queryPreview ? ` for ${queryPreview}` : ''}`;
			}
			case 'get_session_context': {
				const session = (result as { session?: SessionResult }).session;
				return (
					session?.title ||
					(args as { sessionId?: string }).sessionId?.slice(0, 8) ||
					'session'
				);
			}
			case 'get_parent_session': {
				const parentSession = (result as { parentSession?: SessionResult })
					.parentSession;
				return parentSession?.title || 'parent session';
			}
			default:
				return toolName;
		}
	};

	const renderContent = () => {
		const hasArgs = Object.keys(args).length > 0 && !compact;

		switch (toolName) {
			case 'query_sessions': {
				const sessions =
					(result as { sessions?: SessionResult[] }).sessions || [];
				return (
					<div className={compact ? 'p-1' : 'p-2'}>
						{hasArgs && <ArgsPreview args={args} toolName={toolName} />}
						{sessions.length === 0 ? (
							<div className="text-xs text-muted-foreground">
								No sessions found
							</div>
						) : (
							<div className={compact ? 'space-y-0.5' : 'space-y-2'}>
								{sessions.slice(0, compact ? 5 : 10).map((session) => (
									<SessionLink
										key={session.id}
										session={session}
										onNavigate={onNavigateToSession}
										compact={compact}
									/>
								))}
								{sessions.length > (compact ? 5 : 10) && (
									<div className="text-xs text-muted-foreground text-center">
										+{sessions.length - (compact ? 5 : 10)} more
									</div>
								)}
							</div>
						)}
					</div>
				);
			}

			case 'query_messages': {
				const messages =
					(result as { messages?: MessageResult[] }).messages || [];
				return (
					<div className={compact ? 'p-1' : 'p-2'}>
						{hasArgs && <ArgsPreview args={args} toolName={toolName} />}
						{messages.length === 0 ? (
							<div className="text-xs text-muted-foreground">
								No messages found
							</div>
						) : (
							<div className={compact ? 'space-y-0.5' : 'space-y-2'}>
								{messages.slice(0, compact ? 5 : 10).map((msg) => (
									<MessageLink
										key={msg.id}
										message={msg}
										onNavigate={onNavigateToSession}
										compact={compact}
									/>
								))}
								{messages.length > (compact ? 5 : 10) && (
									<div className="text-xs text-muted-foreground text-center">
										+{messages.length - (compact ? 5 : 10)} more
									</div>
								)}
							</div>
						)}
					</div>
				);
			}

			case 'search_history': {
				const results = (result as { results?: SearchResult[] }).results || [];
				const query = args.query as string | undefined;
				return (
					<div className={compact ? 'p-1' : 'p-2'}>
						{query && !compact && (
							<div className="flex items-center gap-1.5 text-xs mb-2 pb-2 border-b border-border">
								<Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
								<span className="text-muted-foreground">Query:</span>
								<span className="text-foreground font-medium">"{query}"</span>
							</div>
						)}
						{results.length === 0 ? (
							<div className="text-xs text-muted-foreground">
								No results found
							</div>
						) : (
							<div className={compact ? 'space-y-0.5' : 'space-y-2'}>
								{results.slice(0, compact ? 5 : 10).map((r, i) => (
									<MessageLink
										key={`${r.sessionId}-${r.messageId}-${i}`}
										message={r}
										onNavigate={onNavigateToSession}
										compact={compact}
									/>
								))}
								{results.length > (compact ? 5 : 10) && (
									<div className="text-xs text-muted-foreground text-center">
										+{results.length - (compact ? 5 : 10)} more
									</div>
								)}
							</div>
						)}
					</div>
				);
			}

			case 'get_session_context':
			case 'get_parent_session': {
				const session =
					toolName === 'get_parent_session'
						? (result as { parentSession?: SessionResult }).parentSession
						: (result as { session?: SessionResult }).session;
				const stats = (
					result as {
						stats?: { totalMessages?: number; totalToolCalls?: number };
					}
				).stats;
				const messages = (
					result as {
						messages?: Array<{
							id: string;
							role: string;
							content: string;
							createdAt: number;
						}>;
					}
				).messages;

				if (!session) {
					return (
						<div
							className={`text-xs text-muted-foreground ${compact ? 'p-1' : 'p-2'}`}
						>
							Session not found
						</div>
					);
				}

				if (compact) {
					return (
						<div className="p-1">
							<SessionLink
								session={session}
								onNavigate={onNavigateToSession}
								compact
							/>
						</div>
					);
				}

				return (
					<div className="p-2 space-y-3">
						<SessionLink session={session} onNavigate={onNavigateToSession} />

						{stats && (
							<div className="flex gap-4 text-xs text-muted-foreground">
								{stats.totalMessages !== undefined && (
									<span>{stats.totalMessages} messages</span>
								)}
								{stats.totalToolCalls !== undefined && (
									<span>{stats.totalToolCalls} tool calls</span>
								)}
							</div>
						)}

						{messages && messages.length > 0 && (
							<div className="space-y-1">
								<div className="text-xs font-medium text-muted-foreground">
									Recent messages:
								</div>
								<div className="space-y-1 max-h-48 overflow-y-auto">
									{messages.slice(0, 5).map((msg) => (
										<div
											key={msg.id}
											className="text-xs p-1.5 rounded bg-muted/30"
										>
											<span className="font-medium capitalize text-foreground/70">
												{msg.role}:{' '}
											</span>
											<span className="text-foreground/60 line-clamp-2">
												{msg.content}
											</span>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				);
			}

			default:
				return (
					<pre className="text-xs p-2 overflow-auto max-h-48">
						{JSON.stringify(result, null, 2)}
					</pre>
				);
		}
	};

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName={toolName}
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasToolError}
				colorVariant="default"
				canExpand={true}
			>
				{!compact && (
					<>
						<ToolHeaderSeparator />
						<span className="text-foreground/70 min-w-0 truncate">
							{getDescription()}
						</span>
					</>
				)}
				{!hasToolError && !compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderSuccess>Done</ToolHeaderSuccess>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
				{hasToolError && !compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderError>Error</ToolHeaderError>
						<ToolHeaderMeta>· {timeStr}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{isExpanded && hasToolError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} />
			)}

			{isExpanded && !hasToolError && (
				<div className={compact ? 'mt-1 ml-3' : 'mt-2 ml-5'}>
					{compact ? (
						<div className="border border-border rounded-md overflow-hidden max-h-48 overflow-y-auto">
							{renderContent()}
						</div>
					) : (
						<ToolContentBox title="results" maxHeight="max-h-96">
							{renderContent()}
						</ToolContentBox>
					)}
				</div>
			)}
		</div>
	);
}
