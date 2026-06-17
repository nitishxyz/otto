import { useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { useConfig } from '../../hooks/useConfig';
import { usePreferences } from '../../hooks/usePreferences';
import { useShareStatus } from '../../hooks/useShareStatus';
import { filterCommands, getCommandDescription } from '../../lib/commands';

const POPUP_TRANSITION = { duration: 0.16, ease: [0.2, 0, 0, 1] } as const;

interface CommandSuggestionsPopupProps {
	query: string;
	selectedIndex: number;
	onSelect: (commandId: string) => void;
	onEnterSelect: (commandId: string | undefined) => void;
	onClose: () => void;
	sessionId?: string;
}

export function CommandSuggestionsPopup({
	query,
	selectedIndex,
	onSelect,
	onEnterSelect,
	onClose,
	sessionId,
}: CommandSuggestionsPopupProps) {
	const { preferences } = usePreferences();
	const { data: config } = useConfig();
	const { data: shareStatus } = useShareStatus(sessionId);

	const state = useMemo(
		() => ({
			vimModeEnabled: preferences.vimMode,
			reasoningEnabled: config?.defaults?.reasoningText ?? true,
			isShared: shareStatus?.shared,
		}),
		[preferences.vimMode, config?.defaults?.reasoningText, shareStatus?.shared],
	);

	const results = useMemo(() => filterCommands(query, state), [query, state]);

	useEffect(() => {
		const element = document.getElementById(`command-item-${selectedIndex}`);
		element?.scrollIntoView({ block: 'nearest' });
	}, [selectedIndex]);

	useEffect(() => {
		onEnterSelect(results[selectedIndex]?.id);
	}, [results, selectedIndex, onEnterSelect]);

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest('[data-command-popup]')) {
				onClose();
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [onClose]);

	if (results.length === 0) {
		return (
			<motion.div
				layout
				data-command-popup
				className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-lg shadow-lg z-50 p-3"
				initial={{ opacity: 0, y: 6, scale: 0.98 }}
				animate={{ opacity: 1, y: 0, scale: 1 }}
				transition={POPUP_TRANSITION}
			>
				<span className="text-muted-foreground text-sm">No commands found</span>
			</motion.div>
		);
	}

	return (
		<motion.div
			layout
			data-command-popup
			className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-lg shadow-lg max-h-[300px] overflow-y-auto z-50"
			initial={{ opacity: 0, y: 6, scale: 0.98 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			transition={POPUP_TRANSITION}
		>
			{results.map((command, index) => {
				const Icon = command.icon;
				return (
					<button
						type="button"
						key={command.id}
						id={`command-item-${index}`}
						onMouseDown={(e) => {
							e.preventDefault();
							onSelect(command.id);
						}}
						className={`w-full text-left px-3 py-2 hover:bg-accent ${
							index === selectedIndex ? 'bg-accent' : ''
						}`}
					>
						<div className="flex items-center gap-3 w-full">
							<Icon className="w-4 h-4 flex-shrink-0 text-primary" />
							<div className="flex-1 min-w-0">
								<div className="font-mono text-sm font-medium text-foreground">
									{command.label}
								</div>
								<div className="text-xs text-muted-foreground truncate">
									{getCommandDescription(command, state)}
								</div>
							</div>
						</div>
					</button>
				);
			})}
		</motion.div>
	);
}
