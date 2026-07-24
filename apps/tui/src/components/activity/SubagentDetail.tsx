import { memo, useMemo } from 'react';
import { ChatView } from '../ChatView.tsx';
import { useSubagentMessages } from '../../hooks/useSubagentMessages.ts';
import { useTheme } from '../../theme.ts';
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

	return (
		<box style={{ width: '100%', height: '100%', flexDirection: 'column' }}>
			<box
				style={{
					flexDirection: 'column',
					paddingLeft: 1,
					paddingRight: 1,
					paddingBottom: 1,
				}}
			>
				<box style={{ flexDirection: 'row', gap: 1, height: 1, width: '100%' }}>
					<text fg={colors.purple}>◇</text>
					<text fg={colors.fgBright}>
						<b>{record.agent}</b>
					</text>
					<text
						fg={
							record.status === 'running'
								? colors.blue
								: record.status === 'completed'
									? colors.green
									: colors.red
						}
					>
						{record.status}
					</text>
					<text
						fg={colors.fgMuted}
						wrapMode="none"
						truncate
						style={{ flexGrow: 1, overflow: 'hidden' }}
					>
						{record.task}
					</text>
				</box>
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
