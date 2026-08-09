import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { useTheme } from '../theme.ts';
import type { ActivitySubagent } from './activity/types.ts';
import { getVisibleWindow, ModalFrame } from './ModalFrame.tsx';

interface SubagentsOverlayProps {
	items: ActivitySubagent[];
	onSelect: (item: ActivitySubagent) => void;
	onClose: () => void;
}

const MAX_VISIBLE_ROWS = 12;

function statusColor(
	status: ActivitySubagent['status'],
	colors: ReturnType<typeof useTheme>['colors'],
) {
	if (status === 'running') return colors.purple;
	if (status === 'completed') return colors.green;
	if (status === 'failed') return colors.red;
	return colors.fgDark;
}

export function SubagentsOverlay({
	items,
	onSelect,
	onClose,
}: SubagentsOverlayProps) {
	const { colors } = useTheme();
	const [selectedIdx, setSelectedIdx] = useState(0);

	useEffect(() => {
		setSelectedIdx((current) =>
			Math.max(0, Math.min(current, items.length - 1)),
		);
	}, [items.length]);

	useKeyboard((key) => {
		if (key.name === 'escape') {
			onClose();
		} else if (items.length === 0) {
			return;
		} else if (key.name === 'up') {
			setSelectedIdx((current) =>
				current <= 0 ? items.length - 1 : current - 1,
			);
		} else if (key.name === 'down') {
			setSelectedIdx((current) =>
				current >= items.length - 1 ? 0 : current + 1,
			);
		} else if (key.name === 'return') {
			const item = items[selectedIdx];
			if (item) onSelect(item);
		}
	});

	const window = getVisibleWindow(items.length, selectedIdx, MAX_VISIBLE_ROWS);

	return (
		<ModalFrame
			title={`Sub-agents (${items.length})`}
			size="lg"
			footer="Up/Down navigate · Enter open split view · Esc close"
		>
			{items.length === 0 ? (
				<box
					style={{ height: 3, alignItems: 'center', justifyContent: 'center' }}
				>
					<text fg={colors.fgDark}>No sub-agents</text>
				</box>
			) : (
				<box style={{ flexDirection: 'column' }}>
					{items.slice(window.start, window.end).map((item, offset) => {
						const index = window.start + offset;
						const active = index === selectedIdx;
						return (
							<box
								key={item.id}
								style={{
									width: '100%',
									height: 1,
									flexDirection: 'row',
									backgroundColor: active ? colors.bgHighlight : undefined,
									overflow: 'hidden',
								}}
							>
								<text fg={active ? colors.purple : colors.bg}>▌</text>
								<text
									style={{ width: 12, flexShrink: 0 }}
									fg={statusColor(item.status, colors)}
									wrapMode="none"
								>
									{item.status}
								</text>
								<text
									style={{ width: 13, flexShrink: 0 }}
									fg={active ? colors.fgBright : colors.fg}
									wrapMode="none"
									truncate
								>
									{item.agent}
								</text>
								<text
									style={{ flexGrow: 1, flexShrink: 1, overflow: 'hidden' }}
									fg={active ? colors.fgMuted : colors.fgDark}
									wrapMode="none"
									truncate
								>
									{item.task}
								</text>
							</box>
						);
					})}
				</box>
			)}
		</ModalFrame>
	);
}
