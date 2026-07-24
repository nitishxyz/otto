import { memo, useMemo } from 'react';
import { TinySpinner } from './TinySpinner.tsx';
import { useTheme } from '../theme.ts';
import { ToolCallItem } from './ToolCallItem.tsx';
import { InlineApproval } from './InlineApproval.tsx';
import { TodoListCard } from './TodoListCard.tsx';
import { MarkdownView } from './Markdown.tsx';
import {
	SubagentResultsCard,
	isSubagentResultsMessage,
	parseSubagentResults,
} from './SubagentResultsCard.tsx';
import { RAIL_BORDER_CHARS } from './rail.ts';
import type { Message, MessagePart, PendingApproval } from '../types.ts';

interface MessageItemProps {
	message: Message;
	isStreaming: boolean;
	isQueued?: boolean;
	isFirstMessage: boolean;
	pendingApprovals?: PendingApproval[];
	onApprove?: (callId: string) => void;
	onDeny?: (callId: string) => void;
}

function extractText(part: MessagePart): string {
	if (
		part.contentJson &&
		typeof part.contentJson === 'object' &&
		!Array.isArray(part.contentJson) &&
		'text' in part.contentJson
	) {
		return String(part.contentJson.text ?? '');
	}
	if (typeof part.content === 'string') {
		try {
			const parsed = JSON.parse(part.content);
			if (parsed && typeof parsed.text === 'string') return parsed.text;
		} catch {}
		return part.content;
	}
	return '';
}

function getSortedParts(message: Message): MessagePart[] {
	if (!message.parts?.length) return [];
	return [...message.parts].sort((a, b) => {
		const indexDiff = (a.index ?? 0) - (b.index ?? 0);
		if (indexDiff !== 0) return indexDiff;
		return (a.startedAt ?? 0) - (b.startedAt ?? 0);
	});
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.round((ms % 60_000) / 1000);
	return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
	return String(count);
}

const SKIP_TOOLS = new Set(['finish', 'progress_update']);

function formatError(raw: string | null | undefined): string {
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object') {
			if (typeof parsed.message === 'string') return parsed.message;
			if (typeof parsed.error === 'string') return parsed.error;
			if (typeof parsed.text === 'string') return parsed.text;
		}
	} catch {}
	return raw;
}

function isToolPart(part: MessagePart): boolean {
	return part.type === 'tool_call' || part.type === 'tool_result';
}

type Block =
	| { key: string; kind: 'part'; part: MessagePart }
	| { key: string; kind: 'tools'; parts: MessagePart[] }
	| { key: string; kind: 'todos'; part: MessagePart };

function partKeyOf(part: MessagePart): string {
	return isToolPart(part) && part.toolCallId
		? `tool-${part.toolCallId}`
		: part.id;
}

function isTodoTool(toolName: string | null): boolean {
	return toolName === 'update_todos' || toolName === 'update_plan';
}

/**
 * Groups message parts into render blocks: consecutive tool parts merge into
 * one compact group, only the latest update_todos survives (as a todo card),
 * and empty text/reasoning parts are dropped so spacing stays uniform.
 */
function buildBlocks(parts: MessagePart[]): Block[] {
	let lastTodoId: string | null = null;
	for (const p of parts) {
		if (isToolPart(p) && isTodoTool(p.toolName)) lastTodoId = p.id;
	}

	const blocks: Block[] = [];
	for (const part of parts) {
		if (isToolPart(part)) {
			const toolName = part.toolName || '';
			if (SKIP_TOOLS.has(toolName)) continue;
			if (isTodoTool(toolName)) {
				if (part.id !== lastTodoId) continue;
				blocks.push({ key: `todos-${part.id}`, kind: 'todos', part });
				continue;
			}
			const prev = blocks[blocks.length - 1];
			if (prev?.kind === 'tools') {
				prev.parts.push(part);
			} else {
				blocks.push({ key: partKeyOf(part), kind: 'tools', parts: [part] });
			}
			continue;
		}
		if (part.type === 'text' || part.type === 'reasoning') {
			if (!extractText(part).trim()) continue;
		}
		blocks.push({ key: part.id, kind: 'part', part });
	}
	return blocks;
}

const PartRenderer = memo(function PartRenderer({
	part,
	isActive,
	isLastPart,
}: {
	part: MessagePart;
	isActive: boolean;
	isLastPart: boolean;
}) {
	const { colors } = useTheme();

	if (part.type === 'text') {
		const text = extractText(part);
		if (!text.trim()) return null;
		const isPartStreaming = isActive && isLastPart && !part.completedAt;
		if (isPartStreaming) {
			// Split at the last newline: the completed head only changes when a
			// line finishes, so the memoized MarkdownView skips re-parsing on
			// every token; the in-progress tail renders as plain text.
			const splitAt = text.lastIndexOf('\n');
			const head = splitAt === -1 ? '' : text.slice(0, splitAt);
			const tail = splitAt === -1 ? text : text.slice(splitAt + 1);
			return (
				<box style={{ width: '100%', flexDirection: 'column' }}>
					{head.trim() ? <MarkdownView content={head} /> : null}
					{tail.trim() ? (
						<text wrapMode="word" fg={colors.fg}>
							{tail}
						</text>
					) : null}
				</box>
			);
		}
		return (
			<box style={{ width: '100%' }}>
				<MarkdownView content={text} />
			</box>
		);
	}

	if (part.type === 'reasoning') {
		const text = extractText(part);
		if (!text.trim()) return null;
		const isThinking = isActive && isLastPart && !part.completedAt;
		const lines = text.split('\n').filter((l) => l.trim());
		let display: string;
		if (isThinking) {
			const tail = lines.slice(-5);
			display = (lines.length > 5 ? '…\n' : '') + tail.join('\n');
		} else {
			const preview = lines[0] ?? '';
			display =
				lines.length > 1
					? `${preview.length > 120 ? `${preview.slice(0, 117)}…` : preview} (+${lines.length - 1} lines)`
					: preview.length > 200
						? `${preview.slice(0, 197)}…`
						: preview;
		}
		return (
			<box style={{ flexDirection: 'column' }}>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					{isThinking ? (
						<TinySpinner fg={colors.fgDark} />
					) : (
						<text fg={colors.fgDimmed}>∴</text>
					)}
					<text fg={colors.fgDark}>
						<i>{isThinking ? 'thinking…' : 'thought'}</i>
					</text>
				</box>
				<box style={{ paddingLeft: 2 }}>
					<text fg={colors.fgDark}>
						<i>{display}</i>
					</text>
				</box>
			</box>
		);
	}

	if (part.type === 'error') {
		const text = formatError(extractText(part));
		return (
			<box
				style={{
					flexDirection: 'row',
					gap: 1,
					width: '100%',
				}}
			>
				<text style={{ flexShrink: 0 }} fg={colors.red}>
					✗
				</text>
				<text fg={colors.red} wrapMode="word">
					{text || 'Error occurred'}
				</text>
			</box>
		);
	}

	return null;
});

function extractProgressInfo(
	part: MessagePart,
): { message: string; stage?: string; pct?: number } | null {
	const cj = part.contentJson as Record<string, unknown> | undefined;
	if (!cj) return null;
	const candidates = [
		cj.result as Record<string, unknown> | undefined,
		cj.args as Record<string, unknown> | undefined,
		cj,
	];
	for (const src of candidates) {
		if (!src || typeof src !== 'object') continue;
		const msg = typeof src.message === 'string' ? src.message : null;
		if (msg) {
			return {
				message: msg,
				stage:
					typeof src.stage === 'string' && src.stage.trim()
						? src.stage
						: undefined,
				pct: typeof src.pct === 'number' ? src.pct : undefined,
			};
		}
	}
	return null;
}

function StreamingIndicator({
	progressPart,
}: {
	progressPart: MessagePart | null;
}) {
	const { colors } = useTheme();

	if (progressPart) {
		const info = extractProgressInfo(progressPart);
		if (info) {
			return (
				<box
					style={{
						flexDirection: 'row',
						alignItems: 'flex-start',
						gap: 1,
						height: 1,
						marginTop: 1,
					}}
				>
					<TinySpinner fg={colors.purple} />
					{info.stage?.trim() && (
						<text style={{ flexShrink: 0 }} fg={colors.fgDark}>
							[{info.stage}]
						</text>
					)}
					<text
						style={{ flexShrink: 1, overflow: 'hidden' }}
						fg={colors.purple}
					>
						{info.message}
					</text>
					{info.pct !== undefined && (
						<text style={{ flexShrink: 0 }} fg={colors.fgDark}>
							{info.pct}%
						</text>
					)}
				</box>
			);
		}
	}

	return (
		<box
			style={{
				flexDirection: 'row',
				alignItems: 'flex-start',
				gap: 1,
				height: 1,
				marginTop: 1,
			}}
		>
			<TinySpinner fg={colors.purple} />
			<text fg={colors.fgDark}>thinking…</text>
		</box>
	);
}

const UserMessage = memo(function UserMessage({
	message,
	isQueued,
	isFirstMessage: _isFirstMessage,
}: {
	message: Message;
	isQueued?: boolean;
	isFirstMessage: boolean;
}) {
	const { colors } = useTheme();
	const parts = useMemo(() => getSortedParts(message), [message]);
	const content = useMemo(() => {
		return parts
			.filter((p) => p.type === 'text')
			.map(extractText)
			.join('');
	}, [parts]);

	const attachmentNames = useMemo(() => {
		const names: string[] = [];
		for (const p of parts) {
			if (p.type === 'image' || p.type === 'file') {
				const cj = p.contentJson as Record<string, unknown> | undefined;
				const name = typeof cj?.name === 'string' ? cj.name : null;
				if (name) {
					names.push(name);
				} else if (p.type === 'image') {
					names.push('image');
				}
			}
		}
		if (message.attachmentNames?.length && names.length === 0) {
			return message.attachmentNames;
		}
		return names;
	}, [parts, message.attachmentNames]);

	const subagentResults = useMemo(() => {
		if (!content || !isSubagentResultsMessage(content)) return null;
		const parsed = parseSubagentResults(content);
		return parsed.length ? parsed : null;
	}, [content]);

	if (subagentResults) {
		return (
			<SubagentResultsCard
				results={subagentResults}
				timestamp={
					message.createdAt > 0 ? formatTime(message.createdAt) : undefined
				}
			/>
		);
	}

	const badgeColor = isQueued ? colors.yellow : colors.userBadge;

	return (
		<box
			customBorderChars={RAIL_BORDER_CHARS}
			style={{
				flexDirection: 'column',
				width: '100%',
				border: ['left'],
				borderColor: badgeColor,
				backgroundColor: colors.bgSubtle,
				paddingLeft: 2,
				paddingRight: 2,
				paddingTop: 1,
				paddingBottom: 1,
				gap: 1,
				marginTop: 1,
			}}
		>
			<box style={{ flexDirection: 'row', gap: 1, height: 1 }}>
				<text fg={badgeColor}>
					<b>you</b>
				</text>
				{message.createdAt > 0 && (
					<text fg={colors.fgDimmed}>{formatTime(message.createdAt)}</text>
				)}
				{isQueued && <text fg={colors.yellow}>· queued</text>}
			</box>
			{attachmentNames.length > 0 && (
				<box
					style={{ flexDirection: 'row', gap: 1, height: 1, flexWrap: 'wrap' }}
				>
					{attachmentNames.map((name) => {
						const short = name.length > 20 ? `${name.slice(0, 17)}…` : name;
						return (
							<box
								key={name}
								style={{
									backgroundColor: colors.bgSubtle,
									paddingLeft: 1,
									paddingRight: 1,
									height: 1,
								}}
							>
								<text fg={colors.fgMuted}>◳ {short}</text>
							</box>
						);
					})}
				</box>
			)}
			{content ? (
				<text fg={isQueued ? colors.fgDark : colors.fgBright} wrapMode="word">
					{content}
				</text>
			) : null}
		</box>
	);
});

function deduplicateToolParts(parts: MessagePart[]): MessagePart[] {
	const resultCallIds = new Set<string>();
	for (const p of parts) {
		if (p.type === 'tool_result' && p.toolCallId) {
			resultCallIds.add(p.toolCallId);
		}
	}
	return parts.filter((p) => {
		if (
			p.type === 'tool_call' &&
			p.toolCallId &&
			resultCallIds.has(p.toolCallId)
		) {
			return false;
		}
		return true;
	});
}

function TurnFooter({ message }: { message: Message }) {
	const { colors } = useTheme();
	const segments: string[] = [];
	if (message.completedAt && message.createdAt > 0) {
		const dur = message.completedAt - message.createdAt;
		if (dur > 0) segments.push(formatDuration(dur));
	}
	const tokens = message.totalTokens ?? message.completionTokens;
	if (tokens) segments.push(`${formatTokens(tokens)} tok`);
	if (segments.length === 0) return null;
	return (
		<box style={{ flexDirection: 'row', gap: 1, height: 1, marginTop: 1 }}>
			<text fg={colors.fgDimmed}>{segments.join(' · ')}</text>
		</box>
	);
}

const AssistantMessage = memo(function AssistantMessage({
	message,
	isStreaming,
	isQueued: _isQueued,
	isFirstMessage: _isFirstMessage,
	pendingApprovals,
	onApprove,
	onDeny,
}: MessageItemProps) {
	const { colors } = useTheme();
	const sortedParts = useMemo(() => getSortedParts(message), [message]);
	const dedupedParts = useMemo(
		() => deduplicateToolParts(sortedParts),
		[sortedParts],
	);
	const isActive = isStreaming && message.status !== 'complete';
	const hasError = message.status === 'error';
	const hasFinish = sortedParts.some((p) => p.toolName === 'finish');

	const latestProgressPart = useMemo(() => {
		for (let i = sortedParts.length - 1; i >= 0; i--) {
			const p = sortedParts[i];
			if (
				(p.type === 'tool_result' || p.type === 'tool_call') &&
				p.toolName === 'progress_update'
			) {
				return p;
			}
		}
		return null;
	}, [sortedParts]);

	const blocks = useMemo(() => buildBlocks(dedupedParts), [dedupedParts]);
	const lastBlock = blocks[blocks.length - 1];
	const lastPartId = lastBlock?.kind === 'part' ? lastBlock.part.id : null;

	const showStreamingIndicator = isActive && !hasFinish;
	const agentColor = message.agent === 'plan' ? colors.cyan : colors.purple;

	return (
		<box
			style={{
				flexDirection: 'column',
				width: '100%',
				paddingLeft: 1,
				paddingRight: 1,
				marginTop: 1,
			}}
		>
			<box style={{ flexDirection: 'row', gap: 0, height: 1 }}>
				<text fg={agentColor}>✦ </text>
				{message.agent && (
					<text fg={agentColor}>
						<b>{message.agent}</b>
					</text>
				)}
				{(message.provider || message.model) && (
					<text fg={colors.fgDimmed}>
						{' '}
						{[message.provider, message.model].filter(Boolean).join('/')}
					</text>
				)}
				{message.createdAt > 0 && (
					<text fg={colors.fgDimmed}> · {formatTime(message.createdAt)}</text>
				)}
			</box>

			{blocks.map((block) => (
				<box
					key={block.key}
					style={{ flexDirection: 'column', width: '100%', marginTop: 1 }}
				>
					{block.kind === 'tools' ? (
						block.parts.map((part) => {
							const approval = part.toolCallId
								? (pendingApprovals?.find(
										(a) => a.callId === part.toolCallId,
									) ?? null)
								: null;
							return (
								<box
									key={partKeyOf(part)}
									style={{ flexDirection: 'column', width: '100%' }}
								>
									<ToolCallItem part={part} />
									{approval && onApprove && onDeny && (
										<InlineApproval
											approval={approval}
											onApprove={onApprove}
											onDeny={onDeny}
										/>
									)}
								</box>
							);
						})
					) : block.kind === 'todos' ? (
						<TodoListCard part={block.part} />
					) : (
						<PartRenderer
							part={block.part}
							isActive={isActive}
							isLastPart={block.part.id === lastPartId}
						/>
					)}
				</box>
			))}

			{showStreamingIndicator && (
				<StreamingIndicator progressPart={latestProgressPart} />
			)}

			{hasError && !sortedParts.some((p) => p.type === 'error') && (
				<box style={{ flexDirection: 'row', gap: 1, marginTop: 1 }}>
					<text style={{ flexShrink: 0 }} fg={colors.red}>
						✗
					</text>
					<text fg={colors.red} wrapMode="word">
						{formatError(message.error) || 'Unknown error'}
					</text>
				</box>
			)}

			{!isActive && message.status === 'complete' && (
				<TurnFooter message={message} />
			)}
		</box>
	);
});

export const MessageItem = memo(function MessageItem({
	message,
	isStreaming,
	isQueued,
	isFirstMessage,
	pendingApprovals,
	onApprove,
	onDeny,
}: MessageItemProps) {
	if (message.role === 'user') {
		return (
			<UserMessage
				message={message}
				isQueued={isQueued}
				isFirstMessage={isFirstMessage}
			/>
		);
	}
	if (message.role === 'assistant') {
		return (
			<AssistantMessage
				message={message}
				isStreaming={isStreaming}
				isQueued={isQueued}
				isFirstMessage={isFirstMessage}
				pendingApprovals={pendingApprovals}
				onApprove={onApprove}
				onDeny={onDeny}
			/>
		);
	}
	return null;
});
