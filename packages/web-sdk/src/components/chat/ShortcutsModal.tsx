import { useEffect, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { Keyboard, Command } from 'lucide-react';

interface ShortcutsModalProps {
	isOpen: boolean;
	onClose: () => void;
}

interface ShortcutItem {
	keys: string[];
	description: string;
	category: string;
}

const SHORTCUTS: ShortcutItem[] = [
	{
		keys: ['Ctrl', 'B'],
		description: 'Toggle left sidebar (sessions)',
		category: 'Navigation',
	},
	{
		keys: ['Ctrl', 'R'],
		description: 'Toggle right sidebar (git)',
		category: 'Navigation',
	},
	{
		keys: ['Ctrl', '/'],
		description: 'Toggle left sidebar collapse/expand',
		category: 'Navigation',
	},
	{
		keys: ['Ctrl', '\\'],
		description: 'Toggle right sidebar collapse/expand',
		category: 'Navigation',
	},
	{
		keys: ['Ctrl', 'J'],
		description: 'Toggle terminal panel',
		category: 'Navigation',
	},
	{
		keys: ['Ctrl', 'N'],
		description: 'Create new session',
		category: 'Navigation',
	},
	{
		keys: ['ESC'],
		description: 'Close sidebar and return to center',
		category: 'Navigation',
	},
	{
		keys: ['J'],
		description: 'Navigate to next item (in focused list)',
		category: 'List Navigation',
	},
	{
		keys: ['K'],
		description: 'Navigate to previous item (in focused list)',
		category: 'List Navigation',
	},
	{
		keys: ['Enter'],
		description: 'Select focused item and return to input',
		category: 'List Navigation',
	},
	{
		keys: ['Space'],
		description: 'Toggle stage/unstage for focused file (git panel)',
		category: 'Git Operations',
	},
	{
		keys: ['A'],
		description: 'Stage all unstaged files',
		category: 'Git Operations',
	},
	{
		keys: ['U'],
		description: 'Unstage all staged files',
		category: 'Git Operations',
	},
	{
		keys: ['C'],
		description: 'Open commit modal (if files are staged)',
		category: 'Git Operations',
	},
	{
		keys: ['Tab'],
		description: 'Toggle plan mode',
		category: 'Chat',
	},
	{
		keys: ['Enter'],
		description: 'Send message',
		category: 'Chat',
	},
	{
		keys: ['Shift', 'Enter'],
		description: 'New line in message',
		category: 'Chat',
	},
	{
		keys: ['Globe', 'hold'],
		description: 'Record voice while held',
		category: 'Chat',
	},
	{
		keys: ['Globe', 'Globe'],
		description: 'Toggle hands-free voice recording',
		category: 'Chat',
	},
	{
		keys: ['Ctrl/Option', 'Space'],
		description: 'Record voice while held (web)',
		category: 'Chat',
	},
	{
		keys: ['Ctrl/Option', 'Space', 'twice'],
		description: 'Toggle hands-free voice recording (web)',
		category: 'Chat',
	},
	{
		keys: ['@'],
		description: 'Mention file (opens file picker)',
		category: 'Chat',
	},
	{
		keys: ['/'],
		description: 'Slash command (opens command menu)',
		category: 'Chat',
	},
];

const VIM_MODE_SHORTCUTS: ShortcutItem[] = [
	{
		keys: ['i'],
		description: 'Enter insert mode at cursor (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['a'],
		description: 'Enter insert mode after cursor (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['I'],
		description: 'Enter insert mode at line start (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['A'],
		description: 'Enter insert mode at line end (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['o'],
		description: 'New line below and enter insert mode (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['O'],
		description: 'New line above and enter insert mode (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['ESC'],
		description: 'Return to normal mode (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['Enter'],
		description: 'Send message in normal mode (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['w'],
		description: 'Jump to next word start (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['e'],
		description: 'Jump to next word end (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['b'],
		description: 'Jump to previous word start (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['x'],
		description: 'Delete character under cursor (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['s'],
		description: 'Delete character and enter insert mode (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['S'],
		description: 'Delete line and enter insert mode (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['f', '{char}'],
		description: 'Find and jump to next character on line (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['d', 'd'],
		description: 'Delete current line (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['0'],
		description: 'Jump to line start (vim mode)',
		category: 'Vim Mode',
	},
	{
		keys: ['$'],
		description: 'Jump to line end (vim mode)',
		category: 'Vim Mode',
	},
];

const SLASH_COMMANDS = [
	{
		command: '/models',
		description: 'Open model selector',
	},
	{
		command: '/agents',
		description: 'Open agent selector',
	},
	{
		command: '/new',
		description: 'Create new session',
	},
	{
		command: '/help',
		description: 'Show keyboard shortcuts and help (this modal)',
	},
	{
		command: '/compact',
		description: 'Compact conversation to reduce context size',
	},
	{
		command: '/init',
		description: 'Generate AGENTS.md and focused .agents docs for the repo',
	},
];

function groupShortcutsByCategory(shortcuts: ShortcutItem[]) {
	const grouped: Record<string, ShortcutItem[]> = {};
	for (const shortcut of shortcuts) {
		if (!grouped[shortcut.category]) {
			grouped[shortcut.category] = [];
		}
		grouped[shortcut.category].push(shortcut);
	}
	return grouped;
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
	const allShortcuts = [...SHORTCUTS, ...VIM_MODE_SHORTCUTS];
	const groupedShortcuts = groupShortcutsByCategory(allShortcuts);
	const modalContentRef = useRef<HTMLDivElement>(null);
	const previousActiveElement = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (isOpen) {
			previousActiveElement.current = document.activeElement as HTMLElement;
			if (previousActiveElement.current) {
				previousActiveElement.current.blur();
			}
		} else {
			if (previousActiveElement.current) {
				previousActiveElement.current.focus();
				previousActiveElement.current = null;
			}
		}
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const isInputField =
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable;

			if (isInputField) return;

			if (e.key === 'j') {
				e.preventDefault();
				const container = modalContentRef.current;
				if (container) {
					container.scrollBy({ top: 100, behavior: 'smooth' });
				}
			} else if (e.key === 'k') {
				e.preventDefault();
				const container = modalContentRef.current;
				if (container) {
					container.scrollBy({ top: -100, behavior: 'smooth' });
				}
			} else if (e.key === 'Enter') {
				e.preventDefault();
				onClose();
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isOpen, onClose]);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={
				<div className="flex items-center gap-2">
					<Keyboard className="w-5 h-5" />
					<span>Keyboard Shortcuts & Help</span>
				</div>
			}
			maxWidth="2xl"
			closeOnEscape={true}
			closeOnBackdropClick={true}
		>
			<div
				ref={modalContentRef}
				className="space-y-6 max-h-[70vh] overflow-y-auto"
			>
				{Object.entries(groupedShortcuts).map(([category, shortcuts]) => (
					<div key={category}>
						<h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
							<Command className="w-4 h-4" />
							{category}
						</h3>
						<div className="space-y-2">
							{shortcuts.map((shortcut, _index) => (
								<div
									key={`${category}-${shortcut.description}`}
									className="flex items-center justify-between py-2 px-3 rounded-lg bg-accent/50 hover:bg-accent transition-colors"
								>
									<span className="text-sm text-foreground">
										{shortcut.description}
									</span>
									<div className="flex items-center gap-1">
										{shortcut.keys.map((key) => (
											<span key={key} className="flex items-center gap-1">
												<kbd className="px-2 py-1 text-xs font-mono bg-background border border-border rounded shadow-sm">
													{key}
												</kbd>
												{shortcut.keys.indexOf(key) <
													shortcut.keys.length - 1 && (
													<span className="text-muted-foreground">+</span>
												)}
											</span>
										))}
									</div>
								</div>
							))}
						</div>
					</div>
				))}

				<div>
					<h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
						<Command className="w-4 h-4" />
						Slash Commands
					</h3>
					<div className="space-y-2">
						{SLASH_COMMANDS.map((cmd, _index) => (
							<div
								key={cmd.command}
								className="flex items-center justify-between py-2 px-3 rounded-lg bg-accent/50 hover:bg-accent transition-colors"
							>
								<span className="text-sm text-foreground">
									{cmd.description}
								</span>
								<kbd className="px-2 py-1 text-xs font-mono bg-background border border-border rounded shadow-sm">
									{cmd.command}
								</kbd>
							</div>
						))}
					</div>
				</div>

				<div className="pt-4 border-t border-border">
					<p className="text-xs text-muted-foreground">
						<strong>Tip:</strong> Shortcuts are disabled when typing in input
						fields. Press <kbd className="text-xs">ESC</kbd> to close popups and
						return focus to chat input.
					</p>
				</div>
			</div>
		</Modal>
	);
}
