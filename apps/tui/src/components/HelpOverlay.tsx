import { useKeyboard } from '@opentui/react';
import { useTheme } from '../theme.ts';
import { getCommandSuggestions } from '../commands/index.ts';
import { ModalFrame, useListModalWindow } from './ModalFrame.tsx';

interface HelpOverlayProps {
	onClose: () => void;
}

export function HelpOverlay({ onClose }: HelpOverlayProps) {
	const { colors } = useTheme();
	const commands = getCommandSuggestions('');
	const rowCount = commands.length + 18;
	const viewport = useListModalWindow(rowCount, 0);

	useKeyboard((key) => {
		if (key.name === 'escape') onClose();
	});

	return (
		<ModalFrame title="Help" size="md" footer="esc close">
			<scrollbox
				style={{
					width: '100%',
					height: Math.min(rowCount, viewport.maxVisible),
					flexShrink: 0,
				}}
				viewportCulling
			>
				<text fg={colors.blue}>
					<b>Commands</b>
				</text>
				<box style={{ flexDirection: 'column', marginTop: 1, gap: 0 }}>
					{commands.map((cmd) => (
						<box
							key={cmd.name}
							style={{
								flexDirection: 'row',
								gap: 1,
								height: 1,
								overflow: 'hidden',
							}}
						>
							<text fg={colors.green}>/{cmd.name}</text>
							{cmd.alias && <text fg={colors.fgDimmed}>({cmd.alias})</text>}
							<text fg={colors.fgDimmed}>—</text>
							<text
								style={{ flexGrow: 1, flexShrink: 1, overflow: 'hidden' }}
								fg={colors.fgMuted}
								wrapMode="none"
								truncate
							>
								{cmd.description}
							</text>
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
						<text fg={colors.fgMuted}>/</text>
						<text fg={colors.fgDimmed}>—</text>
						<text fg={colors.fgDark}>Focus input</text>
					</box>
					<box style={{ flexDirection: 'row', gap: 1 }}>
						<text fg={colors.fgMuted}>Ctrl+Enter</text>
						<text fg={colors.fgDimmed}>—</text>
						<text fg={colors.fgDark}>Send message</text>
					</box>
					<box style={{ flexDirection: 'row', gap: 1 }}>
						<text fg={colors.fgMuted}>Ctrl+D</text>
						<text fg={colors.fgDimmed}>—</text>
						<text fg={colors.fgDark}>Start / stop dictation</text>
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
						<text fg={colors.fgMuted}>Ctrl+R</text>
						<text fg={colors.fgDimmed}>—</text>
						<text fg={colors.fgDark}>Retry last failed request</text>
					</box>
					<box style={{ flexDirection: 'row', gap: 1 }}>
						<text fg={colors.fgMuted}>Ctrl+B</text>
						<text fg={colors.fgDimmed}>—</text>
						<text fg={colors.fgDark}>Show / hide activity</text>
					</box>
					<box style={{ flexDirection: 'row', gap: 1 }}>
						<text fg={colors.fgMuted}>F6</text>
						<text fg={colors.fgDimmed}>—</text>
						<text fg={colors.fgDark}>Cycle workspace focus</text>
					</box>
					<box style={{ flexDirection: 'row', gap: 1 }}>
						<text fg={colors.fgMuted}>Ctrl+H / Ctrl+L</text>
						<text fg={colors.fgDimmed}>—</text>
						<text fg={colors.fgDark}>Focus pane left / right</text>
					</box>
					<box style={{ flexDirection: 'row', gap: 1 }}>
						<text fg={colors.fgMuted}>H / L</text>
						<text fg={colors.fgDimmed}>—</text>
						<text fg={colors.fgDark}>Switch activity tabs</text>
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
			</scrollbox>
		</ModalFrame>
	);
}
