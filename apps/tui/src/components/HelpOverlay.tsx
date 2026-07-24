import { useKeyboard } from '@opentui/react';
import { useTheme } from '../theme.ts';
import { COMMANDS } from '../commands/index.ts';
import { ModalFrame } from './ModalFrame.tsx';

interface HelpOverlayProps {
	onClose: () => void;
}

export function HelpOverlay({ onClose }: HelpOverlayProps) {
	const { colors } = useTheme();

	useKeyboard((key) => {
		if (key.name === 'escape') onClose();
	});

	return (
		<ModalFrame title="Help" size="md" footer="esc close">
			<text fg={colors.blue}>
				<b>Commands</b>
			</text>
			<box style={{ flexDirection: 'column', marginTop: 1, gap: 0 }}>
				{COMMANDS.map((cmd) => (
					<box key={cmd.name} style={{ flexDirection: 'row', gap: 1 }}>
						<text fg={colors.green}>/{cmd.name}</text>
						{cmd.alias && <text fg={colors.fgDimmed}>({cmd.alias})</text>}
						<text fg={colors.fgDimmed}>—</text>
						<text fg={colors.fgMuted}>{cmd.description}</text>
					</box>
				))}
			</box>
			<box style={{ marginTop: 1 }}>
				<text fg={colors.blue}>
					<b>Shortcuts</b>
				</text>
			</box>
			<box style={{ flexDirection: 'column', gap: 0 }}>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<text fg={colors.fgMuted}>Ctrl+Enter</text>
					<text fg={colors.fgDimmed}>—</text>
					<text fg={colors.fgDark}>Send message</text>
				</box>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<text fg={colors.fgMuted}>Ctrl+C</text>
					<text fg={colors.fgDimmed}>—</text>
					<text fg={colors.fgDark}>Abort / Exit</text>
				</box>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<text fg={colors.fgMuted}>Ctrl+N</text>
					<text fg={colors.fgDimmed}>—</text>
					<text fg={colors.fgDark}>New session</text>
				</box>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<text fg={colors.fgMuted}>Ctrl+S</text>
					<text fg={colors.fgDimmed}>—</text>
					<text fg={colors.fgDark}>Sessions list</text>
				</box>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<text fg={colors.fgMuted}>Ctrl+P</text>
					<text fg={colors.fgDimmed}>—</text>
					<text fg={colors.fgDark}>Config</text>
				</box>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<text fg={colors.fgMuted}>Ctrl+T</text>
					<text fg={colors.fgDimmed}>—</text>
					<text fg={colors.fgDark}>Switch theme</text>
				</box>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<text fg={colors.fgMuted}>Escape</text>
					<text fg={colors.fgDimmed}>—</text>
					<text fg={colors.fgDark}>Close overlay</text>
				</box>
			</box>
		</ModalFrame>
	);
}
