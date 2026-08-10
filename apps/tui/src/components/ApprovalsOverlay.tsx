import { useKeyboard } from '@opentui/react';
import { useCallback, useState } from 'react';
import { isListDownKey, isListUpKey } from '../lib/list-navigation.ts';
import { useTheme } from '../theme.ts';
import {
	ModalFrame,
	ModalListViewport,
	SelectRow,
	useListModalWindow,
} from './ModalFrame.tsx';

const APPROVAL_OPTIONS = [
	{
		id: 'auto',
		label: 'Auto',
		description: 'Run normally, but guarded risky commands can still ask.',
	},
	{
		id: 'dangerous',
		label: 'Dangerous only',
		description: 'Ask before dangerous tools and risky changes.',
	},
	{
		id: 'yolo',
		label: 'YOLO',
		description: 'Never ask unless a hard safety block prevents the command.',
	},
	{
		id: 'all',
		label: 'All tools',
		description: 'Ask before every tool call.',
	},
] as const;

type ApprovalMode = (typeof APPROVAL_OPTIONS)[number]['id'];

interface ApprovalsOverlayProps {
	currentMode: ApprovalMode;
	onClose: () => void;
	onSave: (mode: ApprovalMode) => void | Promise<void>;
}

export function ApprovalsOverlay({
	currentMode,
	onClose,
	onSave,
}: ApprovalsOverlayProps) {
	const { colors } = useTheme();
	const [selectedIdx, setSelectedIdx] = useState(
		Math.max(
			0,
			APPROVAL_OPTIONS.findIndex((option) => option.id === currentMode),
		),
	);

	const navigate = useCallback((next: number) => {
		setSelectedIdx(next);
	}, []);

	useKeyboard((key) => {
		if (isListUpKey(key)) {
			const next =
				selectedIdx <= 0 ? APPROVAL_OPTIONS.length - 1 : selectedIdx - 1;
			navigate(next);
		} else if (isListDownKey(key)) {
			const next =
				selectedIdx >= APPROVAL_OPTIONS.length - 1 ? 0 : selectedIdx + 1;
			navigate(next);
		} else if (key.name === 'return') {
			void Promise.resolve(onSave(APPROVAL_OPTIONS[selectedIdx].id)).then(
				onClose,
			);
		} else if (key.name === 'escape') {
			onClose();
		}
	});
	const visibleWindow = useListModalWindow(
		APPROVAL_OPTIONS.length,
		selectedIdx,
	);
	const visibleOptions = APPROVAL_OPTIONS.slice(
		visibleWindow.start,
		visibleWindow.end,
	);

	return (
		<ModalFrame
			title="Tool approvals"
			size="md"
			footer="↑/k · ↓/j move · Enter save · Esc close"
		>
			<text fg={colors.fgMuted}>
				YOLO skips prompts but still blocks catastrophic commands like rm -rf /
			</text>
			<ModalListViewport rowCount={visibleOptions.length}>
				{visibleOptions.map((option, offset) => {
					const index = visibleWindow.start + offset;
					const isSelected = index === selectedIdx;
					const isCurrent = option.id === currentMode;
					return (
						<SelectRow
							key={option.id}
							active={isSelected}
							current={isCurrent}
							title={option.label}
							description={option.description}
							footer={option.id}
						/>
					);
				})}
			</ModalListViewport>
		</ModalFrame>
	);
}
