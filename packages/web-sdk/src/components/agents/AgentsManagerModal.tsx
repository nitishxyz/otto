import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
	ArrowLeft,
	Bot,
	CheckCircle2,
	Cpu,
	FileText,
	Plus,
	RefreshCw,
	Settings2,
	Wrench,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { StableSpinner } from '../ui/StableSpinner';
import {
	useAgentDetails,
	useConfigTools,
	useDeleteAgent,
	useSetDefaultAgent,
	useUpdateAgent,
} from '../../hooks/useAgents';
import type { AgentDetail, ToolDetail } from '../../hooks/useAgents';
import { useAgentsStore } from '../../stores/agentsStore';
import { useConfirmationStore } from '../../stores/confirmationStore';
import { AgentToolList, type ToolBucket } from './AgentToolList';
import { AgentProviderModelFields } from './AgentProviderModelFields';
import { AgentCreatePane } from './CreateAgentModal';
import {
	AGENT_EDITOR_PAGES,
	REQUIRED_TOOLS,
	buildAgentToolConfig,
	getAgentConfigScope,
	normalizeAgentToolConfig,
	toolBucketsFromConfig,
	toolNamesFromConfig,
	type AgentEditorPage,
	type ToolDisplay,
} from './agentConstants';

export const AgentsManagerModal = memo(function AgentsManagerModal() {
	const isOpen = useAgentsStore((s) => s.isManagerOpen);
	const closeManager = useAgentsStore((s) => s.closeManager);
	if (!isOpen) return null;
	return <AgentsManagerContent onClose={closeManager} />;
});

const AgentsManagerContent = memo(function AgentsManagerContent({
	onClose,
}: {
	onClose: () => void;
}) {
	const agents = useAgentsStore((s) => s.agents);
	const defaultAgent = useAgentsStore((s) => s.defaultAgent);
	const selectedAgentName = useAgentsStore((s) => s.selectedAgent);
	const selectAgent = useAgentsStore((s) => s.selectAgent);
	const openCreateModal = useAgentsStore((s) => s.openCreateModal);
	const isCreateOpen = useAgentsStore((s) => s.isCreateModalOpen);
	const mode = useAgentsStore((s) => s.managerMode);
	const setManagerMode = useAgentsStore((s) => s.setManagerMode);
	const workspacePage = useAgentsStore((s) => s.editorPage);
	const setEditorPage = useAgentsStore((s) => s.setEditorPage);

	const workspaceGuardRef = useRef<((next: () => void) => void) | null>(null);

	const registerWorkspaceGuard = useCallback(
		(guard: ((next: () => void) => void) | null) => {
			workspaceGuardRef.current = guard;
		},
		[],
	);

	const runIfAllowed = useCallback((next: () => void) => {
		const guard = workspaceGuardRef.current;
		if (typeof guard === 'function') guard(next);
		else next();
	}, []);

	const { isLoading, isFetching, refetch, error } = useAgentDetails({
		enabled: true,
	});
	const toolsQuery = useConfigTools();

	const selectedAgent =
		agents.find((a) => a.name === selectedAgentName) ?? null;

	const enterWorkspace = (name: string) => {
		const apply = () => {
			selectAgent(name);
			setEditorPage('overview');
			setManagerMode('workspace');
		};
		if (mode === 'workspace') runIfAllowed(apply);
		else apply();
	};

	const returnToLibrary = useCallback(() => {
		setManagerMode('library');
		setEditorPage('overview');
	}, [setEditorPage, setManagerMode]);

	const tryBackToLibrary = () => runIfAllowed(returnToLibrary);

	const tryChangePage = (p: AgentEditorPage) => {
		if (p === workspacePage) return;
		runIfAllowed(() => setEditorPage(p));
	};

	const handleClose = () => {
		onClose();
		workspaceGuardRef.current = null;
	};

	const refresh = () => {
		void refetch();
		void toolsQuery.refetch();
	};

	return (
		<Modal
			isOpen
			onClose={handleClose}
			title={
				<span className="flex items-center gap-2">
					<Bot className="h-5 w-5" />
					Agents
				</span>
			}
			maxWidth="5xl"
			showCloseButton
		>
			<div className="-m-6 flex h-[clamp(420px,70vh,560px)] overflow-hidden">
				{mode === 'workspace' && selectedAgent && !isCreateOpen ? (
					<nav className="flex w-60 shrink-0 flex-col border-r border-border bg-muted/20 py-1">
						<button
							type="button"
							onClick={tryBackToLibrary}
							className="mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
						>
							<ArrowLeft className="h-3.5 w-3.5 shrink-0" />
							All agents
						</button>
						<div className="mb-1 border-b border-border/60" />
						{AGENT_EDITOR_PAGES.map((tab) => (
							<WorkspaceNavItem
								key={tab.id}
								active={workspacePage === tab.id}
								icon={editorNavIcon(tab.id)}
								label={tab.label}
								onClick={() => tryChangePage(tab.id)}
							/>
						))}
					</nav>
				) : null}

				<section className="flex min-w-0 flex-1 flex-col">
					{isLoading ? (
						<div className="flex flex-1 items-center justify-center">
							<StableSpinner title="Loading agents" />
						</div>
					) : error ? (
						<div className="p-6 text-sm text-destructive">
							Failed to load agents: {String(error)}
						</div>
					) : isCreateOpen ? (
						<AgentCreatePane
							agents={agents}
							availableTools={toolsQuery.data?.tools ?? []}
						/>
					) : mode === 'library' ? (
						<AgentsLibraryPane
							agents={agents}
							defaultAgent={defaultAgent}
							onSelect={enterWorkspace}
							onCreate={openCreateModal}
							onRefresh={refresh}
							isRefreshing={isFetching || toolsQuery.isFetching}
						/>
					) : selectedAgent ? (
						<AgentWorkspaceMain
							agent={selectedAgent}
							defaultAgent={defaultAgent}
							page={workspacePage}
							onBackToLibrary={returnToLibrary}
							availableTools={toolsQuery.data?.tools ?? []}
							onRegisterGuard={registerWorkspaceGuard}
						/>
					) : (
						<div className="p-6 text-sm text-muted-foreground">
							Select an agent from the library.
						</div>
					)}
				</section>
			</div>
		</Modal>
	);
});

const WorkspaceNavItem = memo(function WorkspaceNavItem({
	active,
	icon,
	label,
	onClick,
}: {
	active: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`relative flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
				active
					? 'bg-background text-foreground'
					: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
			}`}
		>
			{active ? (
				<motion.span
					layoutId="agents-workspace-nav"
					className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
					transition={{ duration: 0.2, ease: 'easeOut' }}
				/>
			) : null}
			<span className={active ? 'text-foreground' : 'text-muted-foreground'}>
				{icon}
			</span>
			<span className="truncate font-medium">{label}</span>
		</button>
	);
});

function editorNavIcon(page: AgentEditorPage) {
	switch (page) {
		case 'overview':
			return <Settings2 className="h-4 w-4" />;
		case 'prompt':
			return <FileText className="h-4 w-4" />;
		case 'tools':
			return <Wrench className="h-4 w-4" />;
	}
}

const AgentsLibraryPane = memo(function AgentsLibraryPane({
	agents,
	defaultAgent,
	onSelect,
	onCreate,
	onRefresh,
	isRefreshing,
}: {
	agents: AgentDetail[];
	defaultAgent: string | null;
	onSelect: (name: string) => void;
	onCreate: () => void;
	onRefresh: () => void;
	isRefreshing: boolean;
}) {
	const builtIn = agents.filter((a) => a.builtin);
	const custom = agents.filter((a) => !a.builtin);

	return (
		<>
			<div className="shrink-0 border-b border-border px-6 py-4 flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<h2 className="text-base font-semibold">Agent library</h2>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Open an agent to edit prompt, tools, and model overrides.
						{defaultAgent ? ` Default: ${defaultAgent}.` : ''}
					</p>
				</div>
				<div className="flex shrink-0 gap-2">
					<Button
						variant="ghost"
						size="sm"
						className="gap-1.5"
						onClick={onRefresh}
						disabled={isRefreshing}
					>
						<RefreshCw
							className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
						/>
						Refresh
					</Button>
					<Button size="sm" className="gap-1.5" onClick={onCreate}>
						<Plus className="h-3.5 w-3.5" />
						New agent
					</Button>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
				{agents.length === 0 ? (
					<p className="text-sm text-muted-foreground py-8 text-center">
						No agents available.
					</p>
				) : (
					<div className="space-y-6">
						<AgentGroup
							title="Built-in"
							items={builtIn}
							defaultAgent={defaultAgent}
							onSelect={onSelect}
						/>
						<AgentGroup
							title="Custom"
							items={custom}
							defaultAgent={defaultAgent}
							onSelect={onSelect}
						/>
					</div>
				)}
			</div>
		</>
	);
});

const AgentGroup = memo(function AgentGroup({
	title,
	items,
	defaultAgent,
	onSelect,
}: {
	title: string;
	items: AgentDetail[];
	defaultAgent: string | null;
	onSelect: (name: string) => void;
}) {
	if (!items.length) return null;
	return (
		<div>
			<h3 className="text-xs font-medium text-muted-foreground mb-2">
				{title}
			</h3>
			<div className="grid gap-2 sm:grid-cols-2">
				{items.map((agent) => {
					const toolCount = toolNamesFromConfig(agent.toolConfig).length;
					return (
						<button
							type="button"
							key={agent.name}
							onClick={() => onSelect(agent.name)}
							className="rounded-lg border border-border/60 p-3 text-left hover:bg-muted/50 transition-colors"
						>
							<div className="flex items-center gap-2">
								<span className="font-medium text-sm truncate flex-1">
									{agent.name}
								</span>
								{agent.name === defaultAgent && (
									<CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
								)}
							</div>
							<p className="mt-1 text-xs text-muted-foreground">
								{toolCount} tools
								{(agent.provider || agent.model) &&
									` · ${[agent.provider, agent.model].filter(Boolean).join(' / ')}`}
							</p>
						</button>
					);
				})}
			</div>
		</div>
	);
});

const AgentWorkspaceMain = memo(function AgentWorkspaceMain({
	agent,
	defaultAgent,
	page,
	onBackToLibrary,
	availableTools,
	onRegisterGuard,
}: {
	agent: AgentDetail;
	defaultAgent: string | null;
	page: AgentEditorPage;
	onBackToLibrary: () => void;
	availableTools: ToolDetail[];
	onRegisterGuard: (guard: ((next: () => void) => void) | null) => void;
}) {
	const openConfirmation = useConfirmationStore((s) => s.openConfirmation);
	const updateAgent = useUpdateAgent();
	const deleteAgent = useDeleteAgent();
	const setDefaultAgent = useSetDefaultAgent();
	const savedToolNames = useMemo(
		() => toolNamesFromConfig(agent.toolConfig),
		[agent.toolConfig],
	);

	const [prompt, setPrompt] = useState(agent.prompt);
	const [provider, setProvider] = useState(agent.provider ?? '');
	const [model, setModel] = useState(agent.model ?? '');
	const [description, setDescription] = useState(agent.description ?? '');
	const [selectedToolNames, setSelectedToolNames] = useState(
		() => new Set(savedToolNames),
	);
	const [toolBuckets, setToolBuckets] = useState(() =>
		toolBucketsFromConfig(agent.toolConfig),
	);

	useEffect(() => {
		setPrompt(agent.prompt);
		setProvider(agent.provider ?? '');
		setModel(agent.model ?? '');
		setDescription(agent.description ?? '');
		setSelectedToolNames(new Set(savedToolNames));
		setToolBuckets(toolBucketsFromConfig(agent.toolConfig));
	}, [
		agent.prompt,
		agent.provider,
		agent.model,
		agent.description,
		savedToolNames,
		agent.toolConfig,
	]);

	const currentToolConfig = useMemo(
		() => buildAgentToolConfig(selectedToolNames, availableTools, toolBuckets),
		[selectedToolNames, availableTools, toolBuckets],
	);

	const isDirty = useMemo(() => {
		if (prompt !== agent.prompt) return true;
		if (provider !== (agent.provider ?? '')) return true;
		if (model !== (agent.model ?? '')) return true;
		if (description !== (agent.description ?? '')) return true;
		if (selectedToolNames.size !== savedToolNames.length) return true;
		if (savedToolNames.some((t) => !selectedToolNames.has(t))) return true;
		return (
			JSON.stringify(normalizeAgentToolConfig(currentToolConfig)) !==
			JSON.stringify(normalizeAgentToolConfig(agent.toolConfig))
		);
	}, [
		agent,
		prompt,
		provider,
		model,
		description,
		selectedToolNames,
		currentToolConfig,
		savedToolNames,
	]);

	const guard = useCallback(
		(next: () => void) => {
			if (!isDirty) {
				next();
				return;
			}
			openConfirmation({
				title: 'Unsaved changes',
				message: 'Discard unsaved edits for this agent?',
				confirmLabel: 'Discard',
				variant: 'destructive',
				onConfirm: next,
			});
		},
		[isDirty, openConfirmation],
	);

	useEffect(() => {
		onRegisterGuard(guard);
		return () => onRegisterGuard(null);
	}, [guard, onRegisterGuard]);

	const saveAgent = () => {
		updateAgent.mutate({
			name: agent.name,
			input: {
				scope: getAgentConfigScope(agent),
				prompt,
				promptStorage: 'file',
				description: description.trim() || null,
				provider: provider.trim() || null,
				model: model.trim() || null,
				tools: currentToolConfig,
			},
		});
	};

	const resetEdits = () => {
		setPrompt(agent.prompt);
		setProvider(agent.provider ?? '');
		setModel(agent.model ?? '');
		setDescription(agent.description ?? '');
		setSelectedToolNames(new Set(savedToolNames));
		setToolBuckets(toolBucketsFromConfig(agent.toolConfig));
	};

	const isBusy =
		updateAgent.isPending || deleteAgent.isPending || setDefaultAgent.isPending;
	const isDefault = agent.name === defaultAgent;
	const tabMeta = AGENT_EDITOR_PAGES.find((t) => t.id === page);

	const toggleTool = (tool: ToolDisplay) => {
		if (tool.required) return;
		const bucket =
			toolBuckets[tool.name] ??
			(tool.activation === 'loadable' ? 'loadable' : 'first_class');
		setSelectedToolNames((current) => {
			const next = new Set(current);
			if (next.has(tool.name)) {
				next.delete(tool.name);
				setToolBuckets((currentBuckets) => {
					const nextBuckets = { ...currentBuckets };
					delete nextBuckets[tool.name];
					return nextBuckets;
				});
			} else {
				next.add(tool.name);
				setToolBuckets((currentBuckets) => ({
					...currentBuckets,
					[tool.name]: bucket,
				}));
			}
			for (const t of REQUIRED_TOOLS) next.add(t);
			return next;
		});
	};

	const moveTool = (tool: ToolDisplay, bucket: ToolBucket) => {
		if (tool.required) return;
		setSelectedToolNames((current) => new Set([...current, tool.name]));
		setToolBuckets((current) => ({ ...current, [tool.name]: bucket }));
	};

	return (
		<>
			<div className="shrink-0 border-b border-border px-6 py-4 flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<h2 className="text-base font-semibold truncate">
						{tabMeta?.label ?? page}
					</h2>
					{isDirty ? (
						<p className="mt-0.5 text-xs text-muted-foreground">
							Unsaved changes
						</p>
					) : null}
				</div>
				{isDirty && (
					<div className="flex gap-2 shrink-0">
						<Button
							variant="ghost"
							size="sm"
							onClick={resetEdits}
							disabled={isBusy}
						>
							Revert
						</Button>
						<Button size="sm" onClick={saveAgent} disabled={isBusy}>
							{updateAgent.isPending ? 'Saving…' : 'Save'}
						</Button>
					</div>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
				<AnimatePresence mode="wait">
					<motion.div
						key={page}
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -6 }}
						transition={{ duration: 0.15 }}
					>
						{page === 'overview' && (
							<OverviewContent
								agent={agent}
								isDefault={isDefault}
								isBusy={isBusy}
								toolCount={selectedToolNames.size}
								promptLength={prompt.length}
								onSetDefault={() => setDefaultAgent.mutate(agent.name)}
								onResetOrDelete={() =>
									openConfirmation({
										title: agent.builtin ? 'Reset overrides' : 'Delete agent',
										message: agent.builtin
											? `Reset ${agent.name} to built-in defaults?`
											: `Delete ${agent.name}?`,
										confirmLabel: agent.builtin ? 'Reset' : 'Delete',
										variant: 'destructive',
										onConfirm: () =>
											deleteAgent.mutate(
												{
													name: agent.name,
													scope: getAgentConfigScope(agent),
												},
												{ onSuccess: onBackToLibrary },
											),
									})
								}
								provider={provider}
								model={model}
								onProviderChange={setProvider}
								onModelChange={setModel}
								description={description}
								onDescriptionChange={setDescription}
								disabled={isBusy}
							/>
						)}
						{page === 'prompt' && (
							<div className="space-y-2">
								<p className="text-xs text-muted-foreground font-mono break-all">
									{agent.promptSource}
								</p>
								<textarea
									value={prompt}
									onChange={(e) => setPrompt(e.target.value)}
									className="min-h-[min(52vh,520px)] w-full resize-y rounded-md bg-muted/30 p-4 text-sm leading-relaxed font-mono outline-none ring-1 ring-transparent focus:ring-primary/40"
								/>
							</div>
						)}
						{page === 'tools' && (
							<AgentToolList
								selectedToolNames={selectedToolNames}
								toolBuckets={toolBuckets}
								availableTools={availableTools}
								onToggle={toggleTool}
								onMoveTool={moveTool}
								disabled={isBusy}
							/>
						)}
					</motion.div>
				</AnimatePresence>
			</div>
		</>
	);
});

const OverviewContent = memo(function OverviewContent({
	agent,
	isDefault,
	isBusy,
	toolCount,
	promptLength,
	onSetDefault,
	onResetOrDelete,
	provider,
	model,
	onProviderChange,
	onModelChange,
	description,
	onDescriptionChange,
	disabled,
}: {
	agent: AgentDetail;
	isDefault: boolean;
	isBusy: boolean;
	toolCount: number;
	promptLength: number;
	onSetDefault: () => void;
	onResetOrDelete: () => void;
	provider: string;
	model: string;
	onProviderChange: (v: string) => void;
	onModelChange: (v: string) => void;
	description: string;
	onDescriptionChange: (v: string) => void;
	disabled?: boolean;
}) {
	return (
		<div className="space-y-6 max-w-3xl">
			<div className="rounded-lg bg-muted/20 divide-y divide-border/40 text-sm">
				<MetaRow label="Source" value={agent.source} />
				<MetaRow
					label="Overrides"
					value={
						agent.hasLocalOverride || agent.hasGlobalOverride
							? [
									agent.hasLocalOverride && 'local',
									agent.hasGlobalOverride && 'global',
								]
									.filter(Boolean)
									.join(', ')
							: 'None'
					}
				/>
				<MetaRow label="Tools" value={String(toolCount)} />
				<MetaRow label="Prompt" value={`${promptLength} characters`} />
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					variant="secondary"
					size="sm"
					onClick={onSetDefault}
					disabled={isDefault || isBusy}
				>
					{isDefault ? 'Default agent' : 'Set as default'}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={onResetOrDelete}
					disabled={isBusy}
				>
					{agent.builtin ? 'Reset overrides' : 'Delete agent'}
				</Button>
			</div>
			<div className="space-y-1.5">
				<div>
					<div className="text-sm font-medium text-foreground">Description</div>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Shown to other agents so they know when to delegate here.
					</p>
				</div>
				<input
					type="text"
					value={description}
					onChange={(e) => onDescriptionChange(e.target.value)}
					disabled={disabled}
					maxLength={120}
					placeholder={
						agent.defaultDescription ?? 'One line: what this agent is good at'
					}
					className="w-full h-9 px-3 text-sm bg-muted/30 rounded-md outline-none ring-1 ring-border focus:ring-primary/50 transition-shadow disabled:cursor-not-allowed disabled:opacity-50"
				/>
			</div>
			<div className="flex items-center gap-2 text-sm font-medium text-foreground">
				<Cpu className="h-4 w-4 text-muted-foreground" />
				Model overrides
			</div>
			<AgentProviderModelFields
				provider={provider}
				model={model}
				onProviderChange={onProviderChange}
				onModelChange={onModelChange}
				disabled={disabled}
			/>
		</div>
	);
});

function MetaRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between gap-4 px-3 py-2.5">
			<span className="text-muted-foreground">{label}</span>
			<span className="text-foreground text-right">{value}</span>
		</div>
	);
}
