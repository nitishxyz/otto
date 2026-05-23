import { ExternalLink, Search } from 'lucide-react';
import type { RendererProps } from './types';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
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

function getToolDisplayName(toolName: string): string {
	switch (toolName) {
		case 'query_sessions':
			return 'search sessions';
		case 'query_messages':
			return 'search messages';
		case 'search_history':
			return 'search history';
		case 'get_session_context':
			return 'open session';
		case 'get_parent_session':
			return 'open linked session';
		default:
			return toolName;
	}
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
	const meta = [
		session.agent,
		session.provider,
		session.messageCount !== undefined ? `${session.messageCount} msgs` : null,
		session.createdAt ? formatDate(session.createdAt) : null,
	].filter(Boolean);

	return (
		<button
			type="button"
			onClick={() => onNavigate?.(session.id)}
			disabled={!onNavigate}
			className={`group flex w-full items-start justify-between gap-3 text-left transition-colors hover:bg-muted/30 disabled:cursor-default ${
				compact ? 'rounded px-2 py-1 text-xs' : 'px-3 py-2'
			}`}
		>
			<div className="min-w-0 flex-1">
				<div className="truncate font-medium text-foreground/90">
					{session.title || 'Untitled'}
				</div>
				{!compact && meta.length > 0 && (
					<div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
						{meta.map((item) => (
							<span key={item}>{item}</span>
						))}
					</div>
				)}
			</div>
			{onNavigate && (
				<ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
			)}
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
	const meta = [
		message.role,
		message.createdAt ? formatDate(message.createdAt) : null,
	].filter(Boolean);

	return (
		<button
			type="button"
			onClick={() => onNavigate?.(sessionId)}
			disabled={!onNavigate || !sessionId}
			className={`group flex w-full items-start justify-between gap-3 text-left transition-colors hover:bg-muted/30 disabled:cursor-default ${
				compact ? 'rounded px-2 py-1 text-xs' : 'px-3 py-2'
			}`}
		>
			<div className="min-w-0 flex-1">
				<div className="truncate text-xs text-muted-foreground">
					{sessionTitle || sessionId.slice(0, 8)}
				</div>
				{content && (
					<div className="mt-0.5 line-clamp-2 text-foreground/80">
						{compact ? content.slice(0, 64) : content}
					</div>
				)}
				{!compact && meta.length > 0 && (
					<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
						{meta.map((item) => (
							<span key={item} className="capitalize">
								{item}
							</span>
						))}
					</div>
				)}
			</div>
			{onNavigate && sessionId && (
				<ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
			)}
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
			<span key={key} className="inline-flex items-center gap-1">
				<span className="text-muted-foreground">{key}</span>
				<span className="text-muted-foreground/60">=</span>
				<span className="font-mono text-foreground/80">
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
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-2 text-xs">
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
			<div className="mt-2 mb-1 rounded-lg border border-border bg-card/60 text-[12px]">
				<div className="border-b border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground">
					{title ||
						(links.length === 1 ? 'Relevant session' : 'Relevant sessions')}
				</div>
				{links.length === 0 && summary && (
					<div className="px-3 py-2 text-muted-foreground">{summary}</div>
				)}
				{links.length > 0 && (
					<div className="divide-y divide-border/60">
						{links.map((link) => (
							<button
								type="button"
								key={link.sessionId}
								onClick={() => onNavigateToSession?.(link.sessionId)}
								disabled={!onNavigateToSession}
								className="group flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/30 disabled:cursor-default"
							>
								<div className="min-w-0 flex-1">
									<div className="truncate font-medium text-foreground/90">
										{link.title}
									</div>
									{link.description && (
										<div className="mt-0.5 text-muted-foreground">
											{link.description}
										</div>
									)}
								</div>
								{onNavigateToSession && (
									<ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
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
					<div>
						{hasArgs && <ArgsPreview args={args} toolName={toolName} />}
						{sessions.length === 0 ? (
							<div className="px-3 py-2 text-xs text-muted-foreground">
								No sessions found
							</div>
						) : (
							<div
								className={
									compact ? 'space-y-0.5 p-1' : 'divide-y divide-border/60'
								}
							>
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
					<div>
						{hasArgs && <ArgsPreview args={args} toolName={toolName} />}
						{messages.length === 0 ? (
							<div className="px-3 py-2 text-xs text-muted-foreground">
								No messages found
							</div>
						) : (
							<div
								className={
									compact ? 'space-y-0.5 p-1' : 'divide-y divide-border/60'
								}
							>
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
					<div>
						{query && !compact && (
							<div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2 text-xs">
								<Search className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
								<span className="text-muted-foreground">query</span>
								<span className="font-mono text-foreground/80">{query}</span>
							</div>
						)}
						{results.length === 0 ? (
							<div className="px-3 py-2 text-xs text-muted-foreground">
								No results found
							</div>
						) : (
							<div
								className={
									compact ? 'space-y-0.5 p-1' : 'divide-y divide-border/60'
								}
							>
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
					<div>
						<SessionLink session={session} onNavigate={onNavigateToSession} />

						{stats && (
							<div className="flex gap-4 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
								{stats.totalMessages !== undefined && (
									<span>{stats.totalMessages} messages</span>
								)}
								{stats.totalToolCalls !== undefined && (
									<span>{stats.totalToolCalls} tool calls</span>
								)}
							</div>
						)}

						{messages && messages.length > 0 && (
							<div className="border-t border-border/60">
								<div className="px-3 py-1.5 text-xs text-muted-foreground">
									Recent messages
								</div>
								<div className="max-h-48 overflow-y-auto divide-y divide-border/60">
									{messages.slice(0, 5).map((msg) => (
										<div key={msg.id} className="px-3 py-2 text-xs">
											<span className="mr-1 font-medium capitalize text-muted-foreground">
												{msg.role}
											</span>
											<span className="line-clamp-2 text-foreground/70">
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
				toolName={getToolDisplayName(toolName)}
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
