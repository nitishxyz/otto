import { useKeyboard } from '@opentui/react';
import { useState, useRef, useCallback } from 'react';
import { useTheme, themeList } from '../theme.ts';
import { isListDownKey, isListUpKey } from '../lib/list-navigation.ts';
import {
	ModalFrame,
	ModalListViewport,
	SelectRow,
	useListModalWindow,
} from './ModalFrame.tsx';

interface ThemeOverlayProps {
	onClose: () => void;
	onSave: (name: string) => void;
}

export function ThemeOverlay({ onClose, onSave }: ThemeOverlayProps) {
	const { themeName, setTheme } = useTheme();
	const originalThemeRef = useRef(themeName);
	const [selectedIdx, setSelectedIdx] = useState(
		Math.max(
			0,
			themeList.findIndex((t) => t.name === themeName),
		),
	);

	const navigate = useCallback(
		(next: number) => {
			setSelectedIdx(next);
			setTheme(themeList[next].name);
		},
		[setTheme],
	);

	useKeyboard((key) => {
		if (isListUpKey(key)) {
			const next = selectedIdx <= 0 ? themeList.length - 1 : selectedIdx - 1;
			navigate(next);
		} else if (isListDownKey(key)) {
			const next = selectedIdx >= themeList.length - 1 ? 0 : selectedIdx + 1;
			navigate(next);
		} else if (key.name === 'return') {
			onSave(themeList[selectedIdx].name);
			onClose();
		} else if (key.name === 'escape') {
			setTheme(originalThemeRef.current);
			onClose();
		}
	});
	const visibleWindow = useListModalWindow(themeList.length, selectedIdx);
	const visibleThemes = themeList.slice(visibleWindow.start, visibleWindow.end);

	return (
		<ModalFrame
			title="Theme"
			size="sm"
			footer="↑/k · ↓/j preview · Enter confirm · Esc cancel"
		>
			<ModalListViewport rowCount={visibleThemes.length}>
				{visibleThemes.map((t, offset) => {
					const i = visibleWindow.start + offset;
					const isSelected = i === selectedIdx;
					const isCurrent = t.name === themeName;
					return (
						<SelectRow
							key={t.name}
							active={isSelected}
							title={t.displayName}
							description={isCurrent ? 'current' : undefined}
							footer={
								<box style={{ flexDirection: 'row', gap: 0 }}>
									<text fg={t.colors.red}>●</text>
									<text fg={t.colors.green}>●</text>
									<text fg={t.colors.blue}>●</text>
									<text fg={t.colors.yellow}>●</text>
									<text fg={t.colors.purple}>●</text>
								</box>
							}
						/>
					);
				})}
			</ModalListViewport>
		</ModalFrame>
	);
}
