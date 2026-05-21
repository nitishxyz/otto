import { memo, useMemo } from 'react';
import { TinySpinner } from './TinySpinner.tsx';
import { useTheme } from '../theme.ts';
import { ToolCallItem } from './ToolCallItem.tsx';
import { InlineApproval } from './InlineApproval.tsx';
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

const SKIP_TOOLS = new Set(['finish', 'progress_update', 'update_todos']);

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

function getPartCategory(part: MessagePart): string {
	if (part.type === 'tool_call' || part.type === 'tool_result') return 'tool';
	return part.type;
}

const PartRenderer = memo(function PartRenderer({
	part,
	isActive,
	isLastTool,
	prevType,
}: {
	part: MessagePart;
	isActive: boolean;
	isLastTool: boolean;
	prevType: string | null;
}) {
	const { colors, syntaxStyle } = useTheme();
	const category = getPartCategory(part);
	const needsTopGap = prevType === null || prevType !== category;

	if (part.type === 'text') {
		const text = extractText(part);
		if (!text.trim()) return null;
		return (
			<box style={{ width: '100%', marginTop: needsTopGap ? 1 : 0 }}>
				<markdown
					style={{ width: '100%' }}
					content={text}
					syntaxStyle={syntaxStyle}
					streaming={isActive && !part.completedAt}
					conceal
				/>
			</box>
		);
	}

	if (part.type === 'reasoning') {
		const text = extractText(part);
		if (!text.trim()) return null;
		const isThinking = isActive && !part.completedAt;
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
			<box
				style={{
					flexDirection: 'column',
					paddingLeft: 1,
					marginTop: needsTopGap ? 1 : 0,
				}}
			>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<text fg={colors.fgDark}>~</text>
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

	if (isToolPart(part)) {
		const toolName = part.toolName || '';
		if (SKIP_TOOLS.has(toolName)) return null;
		return (
			<ToolCallItem part={part} isLast={isLastTool} isFirst={needsTopGap} />
		);
	}

	if (part.type === 'error') {
		const text = formatError(extractText(part));
		return (
			<box style={{ marginTop: 1, paddingLeft: 1 }}>
				<text fg={colors.red}>{text || 'Error occurred'}</text>
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

	return (
		<box
			style={{
				flexDirection: 'column',
				width: '100%',
				backgroundColor: isQueued ? colors.bgHighlight : colors.userBg,
				paddingLeft: 1,
				paddingRight: 1,
				paddingTop: 1,
				paddingBottom: 1,
			}}
		>
			<box style={{ flexDirection: 'row', gap: 1 }}>
				<text fg={colors.userBadge}>
					<b>you</b>
				</text>
				{message.createdAt > 0 && (
					<text fg={colors.fgDimmed}>{formatTime(message.createdAt)}</text>
				)}
				{isQueued && <text fg={colors.yellow}>queued</text>}
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
									backgroundColor: colors.yellow,
									paddingLeft: 1,
									paddingRight: 1,
									height: 1,
								}}
							>
								<text fg={colors.bgDark}>{short}</text>
							</box>
						);
					})}
				</box>
			)}
			{attachmentNames.length > 0 && <box style={{ height: 1 }} />}
			{content ? (
				<text fg={isQueued ? colors.fgDark : colors.fgBright}>{content}</text>
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

	const toolParts = dedupedParts.filter(
		(p) => isToolPart(p) && !SKIP_TOOLS.has(p.toolName || ''),
	);
	const lastToolIdx =
		toolParts.length > 0
			? dedupedParts.lastIndexOf(toolParts[toolParts.length - 1])
			: -1;

	const showStreamingIndicator = isActive && !hasFinish;

	return (
		<box
			style={{
				flexDirection: 'column',
				width: '100%',
				backgroundColor: colors.assistantBg,
				paddingLeft: 1,
				paddingRight: 1,
				paddingTop: 1,
				paddingBottom: 1,
			}}
		>
			<box style={{ flexDirection: 'row', gap: 0 }}>
				<text fg={colors.purple}>✦ </text>
				{message.agent && (
					<text fg={message.agent === 'plan' ? colors.cyan : colors.purple}>
						<b>{message.agent}</b>
					</text>
				)}
				{message.provider && (
					<>
						<text fg={colors.fgDark}> · </text>
						<text fg={colors.fgMuted}>{message.provider}</text>
					</>
				)}
				{message.model && (
					<>
						<text fg={colors.fgDark}> · </text>
						<text fg={colors.fgDimmed}>{message.model}</text>
					</>
				)}
				{message.createdAt > 0 && (
					<>
						<text fg={colors.fgDark}> · </text>
						<text fg={colors.fgDimmed}>{formatTime(message.createdAt)}</text>
					</>
				)}
			</box>

			{dedupedParts.map((part, i) => {
				const prev = i > 0 ? dedupedParts[i - 1] : null;
				const prevCat = prev ? getPartCategory(prev) : null;
				const approval =
					isToolPart(part) && part.toolCallId
						? (pendingApprovals?.find((a) => a.callId === part.toolCallId) ??
							null)
						: null;
				return (
					<box key={part.id} style={{ flexDirection: 'column', width: '100%' }}>
						<PartRenderer
							part={part}
							isActive={isActive}
							isLastTool={i === lastToolIdx}
							prevType={prevCat}
						/>
						{approval && onApprove && onDeny && (
							<InlineApproval
								approval={approval}
								onApprove={onApprove}
								onDeny={onDeny}
							/>
						)}
					</box>
				);
			})}

			{showStreamingIndicator && (
				<StreamingIndicator progressPart={latestProgressPart} />
			)}

			{hasError && !sortedParts.some((p) => p.type === 'error') && (
				<text fg={colors.red}>
					{formatError(message.error) || 'Unknown error'}
				</text>
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
