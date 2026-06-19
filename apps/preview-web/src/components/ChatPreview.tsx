import { useState, type FC } from 'react';
import { AssistantMessageGroup } from '../../../../packages/web-sdk/src/components/messages/AssistantMessageGroup';
import { ThreadDensityProvider } from '../../../../packages/web-sdk/src/components/messages/threadDensity';
import { UserMessageGroup } from '../../../../packages/web-sdk/src/components/messages/UserMessageGroup';
import type { Message } from '../../../../packages/web-sdk/src/types/api';

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
	'claude-sonnet-4-20250514': { input: 3, output: 15 },
	'claude-opus-4-20250514': { input: 15, output: 75 },
	'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
	'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
	'gpt-4o': { input: 2.5, output: 10 },
	'gpt-4o-mini': { input: 0.15, output: 0.6 },
	'gpt-4-turbo': { input: 10, output: 30 },
	o1: { input: 15, output: 60 },
	'o1-mini': { input: 1.1, output: 4.4 },
	'o3-mini': { input: 1.1, output: 4.4 },
	'gemini-2.0-flash': { input: 0.1, output: 0.4 },
	'gemini-2.5-pro-preview-06-05': { input: 1.25, output: 10 },
	'gemini-2.5-flash-preview-05-20': { input: 0.15, output: 0.6 },
};

function estimateCostUsd(model: string, stats: SessionStats): number {
	const costs = MODEL_COSTS[model];
	if (!costs) return 0;

	return (
		((stats.inputTokens + stats.cachedTokens + stats.cacheCreationTokens) /
			1_000_000) *
			costs.input +
		(stats.outputTokens / 1_000_000) * costs.output
	);
}

interface SessionStats {
	inputTokens: number;
	outputTokens: number;
	cachedTokens: number;
	cacheCreationTokens: number;
	reasoningTokens: number;
	toolTimeMs: number;
	toolCounts: Record<string, number>;
}

interface SharedSessionData {
	title: string | null;
	username: string;
	agent: string;
	provider: string;
	model: string;
	createdAt: number;
	tokenCount?: number;
	stats?: SessionStats;
	messages: SharedMessage[];
}

interface SharedMessage {
	id: string;
	role: 'user' | 'assistant';
	createdAt: number;
	parts: SharedMessagePart[];
}

interface SharedMessagePart {
	type:
		| 'text'
		| 'tool_call'
		| 'tool_result'
		| 'thinking'
		| 'reasoning'
		| 'error';
	content: string;
	toolName?: string;
	toolCallId?: string;
}

interface ChatPreviewProps {
	data: {
		shareId: string;
		title: string | null;
		description: string | null;
		sessionData: SharedSessionData;
		createdAt: number;
		viewCount: number;
	};
}

function parseTextContent(content: string): string {
	try {
		const parsed = JSON.parse(content);
		if (typeof parsed === 'object' && parsed !== null) {
			return (
				parsed.text ||
				parsed.content ||
				parsed.message ||
				JSON.stringify(parsed, null, 2)
			);
		}
		return content;
	} catch {
		return content;
	}
}

function transformMessages(
	sharedMessages: SharedMessage[],
	sessionData: SharedSessionData,
	shareId: string,
): Message[] {
	return sharedMessages.map((msg) => ({
		id: msg.id,
		sessionId: shareId,
		role: msg.role as Message['role'],
		status: 'complete' as const,
		agent: sessionData.agent,
		provider: sessionData.provider,
		model: sessionData.model,
		createdAt: msg.createdAt,
		completedAt: msg.createdAt,
		latencyMs: null,
		inputTokens: null,
		outputTokens: null,
		totalTokens: null,
		error: null,
		parts: msg.parts.map((part, partIndex) => ({
			id: `${msg.id}-part-${partIndex}`,
			messageId: msg.id,
			index: partIndex,
			stepIndex: null,
			type: part.type === 'thinking' ? 'reasoning' : part.type,
			content:
				part.type === 'text' ||
				part.type === 'thinking' ||
				part.type === 'reasoning'
					? parseTextContent(part.content)
					: part.content,
			agent: sessionData.agent,
			provider: sessionData.provider,
			model: sessionData.model,
			startedAt: msg.createdAt,
			completedAt: msg.createdAt,
			toolName: part.toolName ?? null,
			toolCallId: part.toolCallId ?? null,
			toolDurationMs: null,
		})),
	}));
}

function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

function formatCompactNumber(num: number): string {
	if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
	if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
	return num.toString();
}

function formatDuration(ms: number): string {
	if (!ms) return '0s';
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

const ChatPreview: FC<ChatPreviewProps> = ({ data }) => {
	const { sessionData, shareId, title, createdAt, viewCount } = data;
	const [isCompactThread, setIsCompactThread] = useState(true);
	const messages = transformMessages(
		sessionData.messages,
		sessionData,
		shareId,
	);
	const filteredMessages = messages.filter((m) => m.role !== 'system');

	const stats = sessionData.stats;
	const totalTokens = stats
		? stats.inputTokens +
			stats.outputTokens +
			stats.cachedTokens +
			stats.cacheCreationTokens
		: (sessionData.tokenCount ?? 0);

	const toolCountEntries = stats?.toolCounts
		? Object.entries(stats.toolCounts).sort((a, b) => b[1] - a[1])
		: [];

	const estimatedCost = stats ? estimateCostUsd(sessionData.model, stats) : 0;
	const threadDensity = isCompactThread ? 'compact' : 'normal';

	return (
		<div className="min-h-screen bg-background">
			{/* Blog-style Header */}
			<header className="border-b border-border">
				<div className="max-w-3xl mx-auto px-6 py-8">
					<h1 className="text-3xl font-bold text-foreground leading-tight mb-4">
						{title || sessionData.title || 'Untitled Session'}
					</h1>

					{/* Author & Date */}
					<div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
						{sessionData.username && (
							<span className="font-medium text-foreground">
								{sessionData.username}
							</span>
						)}
						{!sessionData.username && <span />}
						<span className="text-muted-foreground">
							{formatDate(createdAt)}
						</span>
					</div>

					{/* Model & Provider */}
					<div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
						<div className="flex items-center gap-2">
							<span className="font-medium text-foreground">
								{sessionData.model}
							</span>
							<span className="opacity-50">·</span>
							<span>{sessionData.provider}</span>
						</div>
						<div className="flex items-center gap-3">
							<span>{viewCount} views</span>
							<fieldset className="inline-flex rounded-full border border-border bg-muted/40 p-0.5 text-xs">
								<legend className="sr-only">Thread density</legend>
								<button
									type="button"
									onClick={() => setIsCompactThread(true)}
									aria-pressed={isCompactThread}
									className={`rounded-full px-2.5 py-1 transition-colors ${
										isCompactThread
											? 'bg-background text-foreground shadow-sm'
											: 'text-muted-foreground hover:text-foreground'
									}`}
								>
									Compact
								</button>
								<button
									type="button"
									onClick={() => setIsCompactThread(false)}
									aria-pressed={!isCompactThread}
									className={`rounded-full px-2.5 py-1 transition-colors ${
										!isCompactThread
											? 'bg-background text-foreground shadow-sm'
											: 'text-muted-foreground hover:text-foreground'
									}`}
								>
									Normal
								</button>
							</fieldset>
						</div>
					</div>
				</div>
			</header>

			{/* Messages */}
			<main className="max-w-3xl mx-auto px-6 py-8">
				<ThreadDensityProvider density={threadDensity}>
					<div className={isCompactThread ? 'space-y-4' : 'space-y-6'}>
						{filteredMessages.map((message, idx) => {
							const prevMessage = filteredMessages[idx - 1];
							const nextMessage = filteredMessages[idx + 1];
							const isLastMessage = idx === filteredMessages.length - 1;

							if (message.role === 'user') {
								const nextAssistantMessage =
									nextMessage && nextMessage.role === 'assistant'
										? nextMessage
										: undefined;
								return (
									<UserMessageGroup
										key={message.id}
										sessionId={shareId}
										message={message}
										isFirst={idx === 0}
										nextAssistantMessageId={nextAssistantMessage?.id}
									/>
								);
							}

							if (message.role === 'assistant') {
								const showHeader =
									!prevMessage || prevMessage.role !== 'assistant';
								const nextIsAssistant =
									nextMessage && nextMessage.role === 'assistant';

								return (
									<AssistantMessageGroup
										key={message.id}
										sessionId={shareId}
										message={message}
										showHeader={showHeader}
										hasNextAssistantMessage={nextIsAssistant}
										isLastMessage={isLastMessage}
										showBranchButton={false}
										compact={isCompactThread}
									/>
								);
							}

							return null;
						})}
					</div>
				</ThreadDensityProvider>
			</main>

			{/* Session Stats Summary */}
			{(stats || totalTokens > 0) && (
				<section className="border-t border-border">
					<div className="max-w-3xl mx-auto px-6 py-10">
						{/* Token Stats Row */}
						<div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
							{stats ? (
								<>
									<div>
										<span className="text-2xl font-light text-foreground">
											{formatCompactNumber(stats.inputTokens)}
										</span>
										<span className="text-muted-foreground ml-1.5">in</span>
									</div>
									<div>
										<span className="text-2xl font-light text-foreground">
											{formatCompactNumber(stats.outputTokens)}
										</span>
										<span className="text-muted-foreground ml-1.5">out</span>
									</div>
									{stats.cachedTokens > 0 && (
										<div>
											<span className="text-2xl font-light text-foreground">
												{formatCompactNumber(stats.cachedTokens)}
											</span>
											<span className="text-muted-foreground ml-1.5">
												cached
											</span>
										</div>
									)}
									{stats.toolTimeMs > 0 && (
										<div>
											<span className="text-2xl font-light text-foreground">
												{formatDuration(stats.toolTimeMs)}
											</span>
											<span className="text-muted-foreground ml-1.5">
												tool time
											</span>
										</div>
									)}
									{estimatedCost > 0 && (
										<div>
											<span className="text-2xl font-light text-foreground">
												${estimatedCost.toFixed(2)}
											</span>
											<span className="text-muted-foreground ml-1.5">est.</span>
										</div>
									)}
								</>
							) : (
								<div>
									<span className="text-2xl font-light text-foreground">
										{formatCompactNumber(totalTokens)}
									</span>
									<span className="text-muted-foreground ml-1.5">tokens</span>
								</div>
							)}
						</div>

						{/* Tools Row */}
						{toolCountEntries.length > 0 && (
							<div className="flex flex-wrap gap-2 mt-6">
								{toolCountEntries.slice(0, 8).map(([tool, count]) => (
									<span
										key={tool}
										className="inline-flex items-center px-2.5 py-1 rounded-md bg-muted/50 text-xs"
									>
										<span className="text-foreground">{tool}</span>
										<span className="text-muted-foreground ml-1.5">
											×{count}
										</span>
									</span>
								))}
								{toolCountEntries.length > 8 && (
									<span className="inline-flex items-center px-2.5 py-1 text-xs text-muted-foreground">
										+{toolCountEntries.length - 8} more
									</span>
								)}
							</div>
						)}
					</div>
				</section>
			)}

			{/* Footer */}
			<footer className="border-t border-border py-6">
				<div className="max-w-3xl mx-auto px-6 flex items-center justify-between text-sm text-muted-foreground">
					<div className="flex items-center gap-2">
						{sessionData.username && (
							<>
								<span>Shared by</span>
								<span className="font-medium text-foreground">
									{sessionData.username}
								</span>
								<span className="opacity-50">·</span>
							</>
						)}
						<span>{sessionData.messages.length} messages</span>
					</div>
					<a
						href="https://github.com/nitishxyz/otto"
						className="text-primary hover:underline flex items-center gap-1"
						target="_blank"
						rel="noopener noreferrer"
					>
						Powered by otto
					</a>
				</div>
			</footer>
		</div>
	);
};

export default ChatPreview;
