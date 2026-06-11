import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { AgentDetail, ToolDetail } from '../../hooks/useAgents';
import {
	useDeleteAgent,
	useSetDefaultAgent,
	useUpdateAgent,
} from '../../hooks/useAgents';
import { useAgentsStore } from '../../stores/agentsStore';
import { useConfirmationStore } from '../../stores/confirmationStore';
import { Button } from '../ui/Button';
import { AgentToolList, type ToolBucket } from './AgentToolList';
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

interface AgentEditorProps {
	agent: AgentDetail;
	defaultAgent: string | null;
	availableTools: ToolDetail[];
}

export const AgentEditor = memo(function AgentEditor({
	agent,
	defaultAgent,
	availableTools,
}: AgentEditorProps) {
	const backToList = useAgentsStore((s) => s.backToList);
	const editorPage = useAgentsStore((s) => s.editorPage);
	const setEditorPage = useAgentsStore((s) => s.setEditorPage);
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

	const toolsDirty = useMemo(() => {
		if (selectedToolNames.size !== savedToolNames.length) return true;
		if (savedToolNames.some((tool) => !selectedToolNames.has(tool)))
			return true;
		return (
			JSON.stringify(normalizeAgentToolConfig(currentToolConfig)) !==
			JSON.stringify(normalizeAgentToolConfig(agent.toolConfig))
		);
	}, [savedToolNames, agent.toolConfig, selectedToolNames, currentToolConfig]);

	const detailsDirty =
		prompt !== agent.prompt ||
		provider !== (agent.provider ?? '') ||
		model !== (agent.model ?? '') ||
		description !== (agent.description ?? '');

	const isDirty = toolsDirty || detailsDirty;

	const requestLeavePage = useCallback(
		(next: () => void) => {
			if (!isDirty) {
				next();
				return;
			}
			openConfirmation({
				title: 'Unsaved changes',
				message: 'You have unsaved edits for this agent. Leave without saving?',
				confirmLabel: 'Discard',
				variant: 'destructive',
				onConfirm: () => next(),
			});
		},
		[isDirty, openConfirmation],
	);

	const handleBack = () => requestLeavePage(backToList);

	const handleTab = (page: AgentEditorPage) => {
		if (page === editorPage) return;
		requestLeavePage(() => setEditorPage(page));
	};

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
			for (const requiredTool of REQUIRED_TOOLS) next.add(requiredTool);
			return next;
		});
	};

	const moveTool = (tool: ToolDisplay, bucket: ToolBucket) => {
		if (tool.required) return;
		setSelectedToolNames((current) => new Set([...current, tool.name]));
		setToolBuckets((current) => ({ ...current, [tool.name]: bucket }));
	};

	const resetEdits = () => {
		setPrompt(agent.prompt);
		setProvider(agent.provider ?? '');
		setModel(agent.model ?? '');
		setDescription(agent.description ?? '');
		setSelectedToolNames(new Set(savedToolNames));
		setToolBuckets(toolBucketsFromConfig(agent.toolConfig));
	};

	const resetOrDeleteAgent = () => {
		openConfirmation({
			title: agent.builtin ? 'Reset overrides' : 'Delete agent',
			message: agent.builtin
				? `Reset ${agent.name} to built-in defaults? Prompt files stay on disk.`
				: `Delete ${agent.name}? Config is removed; prompt files stay on disk.`,
			confirmLabel: agent.builtin ? 'Reset' : 'Delete',
			variant: 'destructive',
			onConfirm: () =>
				deleteAgent.mutate(
					{ name: agent.name, scope: getAgentConfigScope(agent) },
					{ onSuccess: () => backToList() },
				),
		});
	};

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

	const isBusy =
		updateAgent.isPending || deleteAgent.isPending || setDefaultAgent.isPending;
	const isDefault = agent.name === defaultAgent;
	const actionError =
		updateAgent.error ?? deleteAgent.error ?? setDefaultAgent.error ?? null;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 border-b border-sidebar-border/60 px-3 py-2 space-y-2">
				<button
					type="button"
					onClick={handleBack}
					className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					All agents
				</button>
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1">
						<h3 className="text-sm font-semibold truncate">{agent.name}</h3>
						<p className="text-[11px] text-muted-foreground">
							{agent.builtin ? 'Built-in' : 'Custom'} · {agent.source}
							{isDirty ? ' · Unsaved' : ''}
						</p>
					</div>
					<div className="flex flex-wrap gap-1 justify-end">
						{isDirty && (
							<>
								<Button
									variant="ghost"
									size="sm"
									onClick={resetEdits}
									disabled={isBusy}
									className="h-7 px-2 text-xs"
								>
									Revert
								</Button>
								<Button
									size="sm"
									onClick={saveAgent}
									disabled={isBusy}
									className="h-7 px-2 text-xs"
								>
									{updateAgent.isPending ? 'Saving…' : 'Save'}
								</Button>
							</>
						)}
					</div>
				</div>
				<nav className="flex gap-1">
					{AGENT_EDITOR_PAGES.map((tab) => (
						<button
							type="button"
							key={tab.id}
							onClick={() => handleTab(tab.id)}
							className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
								editorPage === tab.id
									? 'bg-accent text-foreground'
									: 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
							}`}
						>
							{tab.label}
						</button>
					))}
				</nav>
			</div>

			<div className="flex-1 overflow-y-auto p-3">
				{actionError && (
					<div className="mb-3 text-[11px] text-destructive">
						{String(actionError)}
					</div>
				)}

				{editorPage === 'overview' && (
					<OverviewPage
						agent={agent}
						isDefault={isDefault}
						isBusy={isBusy}
						onSetDefault={() => setDefaultAgent.mutate(agent.name)}
						onResetOrDelete={resetOrDeleteAgent}
						provider={provider}
						model={model}
						onProviderChange={setProvider}
						onModelChange={setModel}
						description={description}
						onDescriptionChange={setDescription}
						toolCount={selectedToolNames.size}
						promptLength={prompt.length}
					/>
				)}

				{editorPage === 'prompt' && (
					<PromptPage
						promptSource={agent.promptSource}
						prompt={prompt}
						onPromptChange={setPrompt}
					/>
				)}

				{editorPage === 'tools' && (
					<AgentToolList
						selectedToolNames={selectedToolNames}
						toolBuckets={toolBuckets}
						availableTools={availableTools}
						onToggle={toggleTool}
						onMoveTool={moveTool}
						disabled={isBusy}
					/>
				)}
			</div>
		</div>
	);
});

const OverviewPage = memo(function OverviewPage({
	agent,
	isDefault,
	isBusy,
	onSetDefault,
	onResetOrDelete,
	provider,
	model,
	onProviderChange,
	onModelChange,
	description,
	onDescriptionChange,
	toolCount,
	promptLength,
}: {
	agent: AgentDetail;
	isDefault: boolean;
	isBusy: boolean;
	onSetDefault: () => void;
	onResetOrDelete: () => void;
	provider: string;
	model: string;
	onProviderChange: (v: string) => void;
	onModelChange: (v: string) => void;
	description: string;
	onDescriptionChange: (v: string) => void;
	toolCount: number;
	promptLength: number;
}) {
	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-sidebar-border/60 p-3 space-y-2 text-xs">
				<Row label="Editable" value={agent.editable ? 'Yes' : 'No'} />
				<Row
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
				<Row label="Tools enabled" value={String(toolCount)} />
				<Row label="Prompt size" value={`${promptLength} chars`} />
			</div>

			<div className="flex flex-wrap gap-2">
				<Button
					variant="ghost"
					size="sm"
					onClick={onSetDefault}
					disabled={isDefault || isBusy}
					className="h-8 text-xs"
				>
					{isDefault ? 'Default agent' : 'Set as default'}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={onResetOrDelete}
					disabled={isBusy}
					className="h-8 text-xs"
				>
					{agent.builtin ? 'Reset overrides' : 'Delete agent'}
				</Button>
			</div>

			<div className="space-y-2">
				<Field
					label="Description"
					value={description}
					onChange={onDescriptionChange}
					placeholder={
						agent.defaultDescription ??
						'One line: what this agent is good at (shown to other agents)'
					}
					maxLength={120}
				/>
				<Field
					label="Provider override"
					value={provider}
					onChange={onProviderChange}
					placeholder="Inherit session default"
				/>
				<Field
					label="Model override"
					value={model}
					onChange={onModelChange}
					placeholder="Inherit provider default"
				/>
			</div>
		</div>
	);
});

const PromptPage = memo(function PromptPage({
	promptSource,
	prompt,
	onPromptChange,
}: {
	promptSource: string;
	prompt: string;
	onPromptChange: (v: string) => void;
}) {
	return (
		<div className="space-y-2">
			<p className="text-[11px] text-muted-foreground font-mono break-all">
				{promptSource}
			</p>
			<textarea
				value={prompt}
				onChange={(e) => onPromptChange(e.target.value)}
				placeholder="No prompt configured."
				className="min-h-[min(50vh,480px)] w-full resize-y rounded-md border border-sidebar-border/60 bg-muted/30 p-3 text-xs leading-relaxed outline-none focus:border-foreground/20 font-mono"
			/>
		</div>
	);
});

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between gap-3">
			<span className="text-muted-foreground">{label}</span>
			<span className="text-foreground text-right">{value}</span>
		</div>
	);
}

function Field({
	label,
	value,
	onChange,
	placeholder,
	maxLength,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder: string;
	maxLength?: number;
}) {
	return (
		<div className="rounded-md border border-sidebar-border/60 p-2">
			<div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
				{label}
			</div>
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				maxLength={maxLength}
				className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground"
			/>
		</div>
	);
}
