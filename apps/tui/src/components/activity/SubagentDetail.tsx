import { memo, useMemo } from 'react';
import { ChatView } from '../ChatView.tsx';
import { useSubagentMessages } from '../../hooks/useSubagentMessages.ts';
import { useTheme } from '../../theme.ts';
import { NARROW_RAIL_BORDER_CHARS } from '../rail.ts';
import type { ActivitySubagent } from './types.ts';

const EMPTY_IDS = new Set<string>();
const NOOP = () => {};

export const SubagentDetail = memo(function SubagentDetail({
	record,
}: {
	record: ActivitySubagent;
}) {
	const { colors } = useTheme();
	const detail = useSubagentMessages(
		record.childSessionId,
		record.status === 'running',
	);
	const streamingMessageId = useMemo(() => {
		for (let index = detail.messages.length - 1; index >= 0; index -= 1) {
			const message = detail.messages[index];
			if (message.role === 'assistant' && message.status === 'pending') {
				return message.id;
			}
		}
		return null;
	}, [detail.messages]);
	const statusColor =
		record.status === 'running'
			? colors.purple
			: record.status === 'completed'
				? colors.green
				: record.status === 'failed'
					? colors.red
					: colors.fgDark;

	return (
		<box style={{ width: '100%', height: '100%', flexDirection: 'column' }}>
			<box
				customBorderChars={NARROW_RAIL_BORDER_CHARS}
				style={{
					flexDirection: 'row',
					height: 3,
					flexShrink: 0,
					border: ['left'],
					borderColor: colors.purple,
					backgroundColor: colors.bgSubtle,
					paddingLeft: 2,
					paddingRight: 2,
					paddingTop: 1,
					paddingBottom: 1,
					gap: 1,
					alignItems: 'center',
					overflow: 'hidden',
				}}
			>
				<text style={{ flexShrink: 0 }} fg={colors.purple}>
					◇
				</text>
				<text style={{ flexShrink: 0 }} fg={colors.fgBright} wrapMode="none">
					<b>{record.agent}</b>
				</text>
				<text fg={colors.fgDimmed} style={{ flexShrink: 0 }}>
					·
				</text>
				<text
					fg={colors.fgMuted}
					wrapMode="none"
					truncate
					style={{ flexGrow: 1, flexShrink: 1, overflow: 'hidden' }}
				>
					{record.task}
				</text>
				<text style={{ flexShrink: 0 }} fg={statusColor} wrapMode="none">
					● {record.status}
				</text>
			</box>

			{detail.error ? (
				<text fg={colors.red} style={{ padding: 2 }}>
					{detail.error}
				</text>
			) : detail.loading && detail.messages.length === 0 ? (
				<box
					style={{
						flexGrow: 1,
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<text fg={colors.fgDimmed}>Loading sub-agent session…</text>
				</box>
			) : detail.messages.length === 0 ? (
				<box
					style={{
						flexGrow: 1,
						alignItems: 'center',
						justifyContent: 'center',
						flexDirection: 'column',
						gap: 1,
					}}
				>
					<text fg={colors.fgDimmed}>No child-session messages yet</text>
					{record.summary ? (
						<text fg={colors.fgMuted} wrapMode="word">
							{record.summary}
						</text>
					) : null}
				</box>
			) : (
				<ChatView
					messages={detail.messages}
					isStreaming={record.status === 'running'}
					streamingMessageId={streamingMessageId}
					queuedMessageIds={EMPTY_IDS}
					pendingApprovals={[]}
					onApprove={NOOP}
					onDeny={NOOP}
				/>
			)}
		</box>
	);
});
