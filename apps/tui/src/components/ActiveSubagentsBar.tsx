import { useTheme } from '../theme.ts';
import type { ActivitySubagent } from './activity/types.ts';
import { NARROW_RAIL_BORDER_CHARS } from './rail.ts';

export function ActiveSubagentsBar({ items }: { items: ActivitySubagent[] }) {
	const { colors } = useTheme();
	if (items.length === 0) return null;
	const first = items[0];
	const label = `${items.length} Active Sub-agent${items.length === 1 ? '' : 's'}`;

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
					borderColor: colors.purple,
					backgroundColor: colors.bgSubtle,
					flexDirection: 'row',
					overflow: 'hidden',
					paddingLeft: 2,
					paddingRight: 2,
				}}
			>
				<text style={{ flexShrink: 0 }} fg={colors.purple} wrapMode="none">
					<b>{label}</b>
				</text>
				<text
					style={{ flexGrow: 1, flexShrink: 1, overflow: 'hidden' }}
					fg={colors.fgMuted}
					wrapMode="none"
					truncate
				>
					{'  ·  '}
					{first.agent}: {first.task}
				</text>
			</box>
		</box>
	);
}
