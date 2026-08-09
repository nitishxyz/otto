import { useTheme } from '../theme.ts';
import { NARROW_RAIL_BORDER_CHARS } from './rail.ts';

export function QueueBar({
	count,
	nextMessage,
}: {
	count: number;
	nextMessage?: string;
}) {
	const { colors } = useTheme();
	if (count <= 0) return null;

	return (
		<box
			style={{
				width: '100%',
				flexShrink: 0,
				paddingLeft: 1,
				paddingRight: 1,
			}}
		>
			<box
				customBorderChars={NARROW_RAIL_BORDER_CHARS}
				style={{
					width: '100%',
					height: 1,
					border: ['left'],
					borderColor: colors.orange,
					backgroundColor: colors.bgSubtle,
					flexDirection: 'row',
					overflow: 'hidden',
					paddingLeft: 2,
					paddingRight: 2,
				}}
			>
				<text style={{ flexShrink: 0 }} fg={colors.orange} wrapMode="none">
					<b>{count} Queued</b>
				</text>
				{nextMessage && (
					<text
						style={{ flexGrow: 1, flexShrink: 1, overflow: 'hidden' }}
						fg={colors.fgMuted}
						wrapMode="none"
						truncate
					>
						{'  ·  '}
						{nextMessage}
					</text>
				)}
			</box>
		</box>
	);
}
