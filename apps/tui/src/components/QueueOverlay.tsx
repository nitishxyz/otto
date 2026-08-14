import { useKeyboard } from '@opentui/react';
import { useEffect, useMemo, useState } from 'react';
import { isListDownKey, isListUpKey } from '../lib/list-navigation.ts';
import { useTheme } from '../theme.ts';
import type { QueuedMessageItem } from '../lib/queue.ts';
import {
	ModalFrame,
	ModalListViewport,
	useListModalWindow,
} from './ModalFrame.tsx';

interface QueueOverlayProps {
	items: QueuedMessageItem[];
	onSend: (assistantMessageId: string) => Promise<boolean>;
	onRemove: (assistantMessageId: string) => Promise<boolean>;
	onRestore: (item: QueuedMessageItem) => Promise<boolean>;
	onClose: () => void;
}

export function QueueOverlay({
	items,
	onSend,
	onRemove,
	onRestore,
	onClose,
}: QueueOverlayProps) {
	const { colors } = useTheme();
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const visibleItems = useMemo(
		() => items.filter((item) => !removedIds.has(item.assistantMessageId)),
		[items, removedIds],
	);

	useEffect(() => {
		setSelectedIdx((current) =>
			Math.max(0, Math.min(current, visibleItems.length - 1)),
		);
	}, [visibleItems.length]);

	useKeyboard((key) => {
		if (key.name === 'escape') {
			onClose();
			return;
		}
		if (busy || visibleItems.length === 0) return;

		if (isListUpKey(key)) {
			setSelectedIdx((current) =>
				current <= 0 ? visibleItems.length - 1 : current - 1,
			);
		} else if (isListDownKey(key)) {
			setSelectedIdx((current) =>
				current >= visibleItems.length - 1 ? 0 : current + 1,
			);
		} else if (key.name === 'return') {
			const item = visibleItems[selectedIdx];
			if (!item) return;
			setBusy(true);
			void onSend(item.assistantMessageId).then((sent) => {
				setBusy(false);
				if (sent) onClose();
			});
		} else if (key.name.toLowerCase() === 'd') {
			const item = visibleItems[selectedIdx];
			if (!item) return;
			setBusy(true);
			void onRemove(item.assistantMessageId).then((removed) => {
				setBusy(false);
				if (!removed) return;
				setRemovedIds((current) =>
					new Set(current).add(item.assistantMessageId),
				);
			});
		} else if (key.name.toLowerCase() === 'r') {
			const item = visibleItems[selectedIdx];
			if (!item) return;
			setBusy(true);
			void onRestore(item).then((restored) => {
				setBusy(false);
				if (restored) onClose();
			});
		}
	});

	const window = useListModalWindow(visibleItems.length, selectedIdx);

	return (
		<ModalFrame
			title={`Queue (${visibleItems.length})`}
			size="lg"
			footer="↑/k · ↓/j navigate · Enter send · D remove · R edit · Esc close"
		>
			{visibleItems.length === 0 ? (
				<box
					style={{ height: 3, alignItems: 'center', justifyContent: 'center' }}
				>
					<text fg={colors.fgDark}>No queued messages</text>
				</box>
			) : (
				<ModalListViewport rowCount={window.end - window.start}>
					{visibleItems.slice(window.start, window.end).map((item, offset) => {
						const index = window.start + offset;
						const active = index === selectedIdx;
						return (
							<box
								key={item.assistantMessageId}
								style={{
									width: '100%',
									height: 1,
									flexDirection: 'row',
									backgroundColor: active ? colors.bgHighlight : undefined,
									overflow: 'hidden',
								}}
							>
								<text fg={active ? colors.orange : colors.bg}>▌</text>
								<text
									style={{ width: 4, flexShrink: 0 }}
									fg={active ? colors.orange : colors.fgDark}
								>
									{index + 1}.
								</text>
								<text
									style={{ flexGrow: 1, flexShrink: 1, overflow: 'hidden' }}
									fg={active ? colors.fgBright : colors.fgMuted}
									wrapMode="none"
									truncate
								>
									{item.summary}
								</text>
							</box>
						);
					})}
				</ModalListViewport>
			)}
		</ModalFrame>
	);
}
