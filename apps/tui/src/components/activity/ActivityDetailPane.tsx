import { memo } from 'react';
import { useTheme } from '../../theme.ts';
import type { ActivityData, ActivityDetail } from './types.ts';
import { ShellDetail, TerminalDetail } from './ProcessDetail.tsx';
import { SubagentDetail } from './SubagentDetail.tsx';

export const ActivityDetailPane = memo(function ActivityDetailPane({
	detail,
	data,
	focused,
	onFocusRequest,
}: {
	detail: ActivityDetail;
	data: ActivityData;
	focused: boolean;
	onFocusRequest: () => void;
	onBack: () => void;
}) {
	const { colors } = useTheme();
	const content = (() => {
		if (detail.kind === 'subagent') {
			const record = data.subagents.find((item) => item.id === detail.id);
			return record ? <SubagentDetail record={record} /> : null;
		}
		if (detail.kind === 'shell') {
			const job = data.shells.find((item) => item.id === detail.id);
			return job ? (
				<ShellDetail job={job} focused={focused} onRefresh={data.refresh} />
			) : null;
		}
		const terminal = data.terminals.find((item) => item.id === detail.id);
		return terminal ? (
			<TerminalDetail
				terminal={terminal}
				focused={focused}
				onRefresh={data.refresh}
			/>
		) : null;
	})();

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI panes use mouse focus without DOM roles
		<box
			border
			borderStyle="single"
			borderColor={focused ? colors.borderActive : colors.bg}
			focusable
			focused={focused}
			onMouseDown={onFocusRequest}
			style={{
				width: '100%',
				height: '100%',
				flexDirection: 'column',
			}}
		>
			{content ?? (
				<box
					style={{
						flexGrow: 1,
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<text fg={colors.fgDimmed}>This activity is no longer available</text>
				</box>
			)}
		</box>
	);
});
