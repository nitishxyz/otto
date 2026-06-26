import { useEffect, useMemo } from 'react';
import { ChefHat } from 'lucide-react';
import { motion } from 'motion/react';
import { useConfig } from '../../hooks/useConfig';
import { usePluginCommands } from '../../hooks/usePluginCommands';
import { usePreferences } from '../../hooks/usePreferences';
import { useRecipes } from '../../hooks/useRecipes';
import { useShareStatus } from '../../hooks/useShareStatus';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import {
	type Command,
	COMMAND_KIND_STYLES,
	filterCommands,
	findPluginCommandEntry,
	getCommandDescription,
	getMissingRequiredParams,
	getPluginCommandStage,
	getPluginNamespaces,
	pluginCommandRows,
	pluginNamespaceCommands,
	pluginParameterRows,
} from '../../lib/commands';

const POPUP_TRANSITION = { duration: 0.16, ease: [0.2, 0, 0, 1] } as const;

interface CommandSuggestionsPopupProps {
	query: string;
	inputValue: string;
	selectedIndex: number;
	onSelect: (commandId: string) => void;
	onEnterSelect: (commandId: string | undefined) => void;
	onResultsChange?: (count: number) => void;
	onMissingRequiredChange?: (params: string[]) => void;
	onStageChange?: (kind: 'root' | 'namespace' | 'params') => void;
	onClose: () => void;
	sessionId?: string;
}

function matchesQuery(command: Command, lowerQuery: string): boolean {
	if (!lowerQuery) return true;
	if (command.label.toLowerCase().includes(lowerQuery)) return true;
	const desc =
		typeof command.description === 'string' ? command.description : '';
	return desc.toLowerCase().includes(lowerQuery);
}

export function CommandSuggestionsPopup({
	query,
	inputValue,
	selectedIndex,
	onSelect,
	onEnterSelect,
	onResultsChange,
	onMissingRequiredChange,
	onStageChange,
	onClose,
	sessionId,
}: CommandSuggestionsPopupProps) {
	const { preferences } = usePreferences();
	const { data: config } = useConfig();
	const { data: shareStatus } = useShareStatus(sessionId);
	const { data: recipesData } = useRecipes();
	const { data: pluginCommandsData } = usePluginCommands();
	const followToolActivity = useViewerTabsStore(
		(state) => state.followToolActivity,
	);

	const state = useMemo(
		() => ({
			vimModeEnabled: preferences.vimMode,
			reasoningEnabled: config?.defaults?.reasoningText ?? true,
			followToolActivity,
			isShared: shareStatus?.shared,
		}),
		[
			preferences.vimMode,
			config?.defaults?.reasoningText,
			followToolActivity,
			shareStatus?.shared,
		],
	);

	const pluginCommands = useMemo(
		() => pluginCommandsData?.commands ?? [],
		[pluginCommandsData?.commands],
	);

	const namespaces = useMemo(
		() => getPluginNamespaces(pluginCommands),
		[pluginCommands],
	);

	const stage = useMemo(
		() =>
			getPluginCommandStage(
				inputValue,
				namespaces.map((ns) => ns.name),
			),
		[inputValue, namespaces],
	);

	const recipeCommands = useMemo(() => {
		const seen = new Set<string>();
		return (recipesData?.recipes ?? [])
			.filter((recipe) => !recipe.conflict)
			.filter((recipe) => {
				if (seen.has(recipe.name)) return false;
				seen.add(recipe.name);
				return true;
			})
			.map((recipe) => ({
				id: `recipe:${recipe.name}`,
				label: `/${recipe.name}`,
				description: recipe.description
					? `${recipe.description} (${recipe.scope})`
					: `${recipe.scope} recipe`,
				icon: ChefHat,
				kind: 'recipe' as const,
			}));
	}, [recipesData?.recipes]);

	const namespaceCommands = useMemo(
		() => pluginNamespaceCommands(namespaces),
		[namespaces],
	);

	const results = useMemo<Command[]>(() => {
		if (stage?.kind === 'namespace') {
			const rows = pluginCommandRows(stage.namespace, pluginCommands);
			const lower = stage.query.toLowerCase();
			return rows.filter((cmd) => matchesQuery(cmd, lower));
		}
		if (stage?.kind === 'params') {
			const entry = findPluginCommandEntry(
				pluginCommands,
				stage.namespace,
				stage.command,
			);
			if (!entry) return [];
			const rows = pluginParameterRows(entry);
			const lower = stage.query.toLowerCase();
			return rows.filter((cmd) => matchesQuery(cmd, lower));
		}
		return filterCommands(query, state, [
			...recipeCommands,
			...namespaceCommands,
		]);
	}, [stage, pluginCommands, query, state, recipeCommands, namespaceCommands]);

	const missingRequired = useMemo(() => {
		if (stage?.kind !== 'params') return [];
		const entry = findPluginCommandEntry(
			pluginCommands,
			stage.namespace,
			stage.command,
		);
		if (!entry) return [];
		return getMissingRequiredParams(entry, inputValue);
	}, [stage, pluginCommands, inputValue]);

	useEffect(() => {
		const element = document.getElementById(`command-item-${selectedIndex}`);
		element?.scrollIntoView({ block: 'nearest' });
	}, [selectedIndex]);

	useEffect(() => {
		onEnterSelect(results[selectedIndex]?.id);
	}, [results, selectedIndex, onEnterSelect]);

	useEffect(() => {
		onResultsChange?.(results.length);
	}, [results.length, onResultsChange]);

	useEffect(() => {
		onMissingRequiredChange?.(missingRequired);
	}, [missingRequired, onMissingRequiredChange]);

	useEffect(() => {
		onStageChange?.(stage?.kind ?? 'root');
	}, [stage?.kind, onStageChange]);

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

	const guidance =
		stage?.kind === 'params' && missingRequired.length > 0
			? `Missing required: ${missingRequired.map((p) => `--${p}`).join(', ')}`
			: undefined;

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
				<span className="text-muted-foreground text-sm">
					{guidance ?? 'No commands found'}
				</span>
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
				const iconClass = COMMAND_KIND_STYLES[command.kind];
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
							<Icon className={`w-4 h-4 flex-shrink-0 ${iconClass}`} />
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
			{guidance && (
				<div className="px-3 py-2 border-t border-border text-xs text-amber-400">
					{guidance}
				</div>
			)}
		</motion.div>
	);
}
