import { memo, useId, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../ui/Button';
import { useAgentsStore } from '../../stores/agentsStore';
import { useUpdateAgent } from '../../hooks/useAgents';
import type { AgentDetail, ToolDetail } from '../../hooks/useAgents';
import {
	BLANK_AGENT_PROMPT,
	REQUIRED_TOOLS,
	TOOL_PRESETS,
	buildAgentToolConfig,
	toolNamesFromConfig,
} from './agentConstants';
import { AgentProviderModelFields } from './AgentProviderModelFields';

const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;

const FIELD_CLASS =
	'w-full h-9 px-3 text-sm bg-muted/30 rounded-md outline-none ring-1 ring-border focus:ring-primary/50 transition-shadow';

function suggestAgentName(baseName: string, agents: AgentDetail[]): string {
	const existing = new Set(agents.map((agent) => agent.name));
	const normalizedBase = `${baseName}-copy`.replace(/[^a-zA-Z0-9_-]/g, '-');
	if (!existing.has(normalizedBase)) return normalizedBase;
	for (let index = 2; index < 1000; index += 1) {
		const candidate = `${normalizedBase}-${index}`;
		if (!existing.has(candidate)) return candidate;
	}
	return `${normalizedBase}-${Date.now()}`;
}

interface AgentCreatePaneProps {
	agents: AgentDetail[];
	availableTools: ToolDetail[];
}

export const AgentCreatePane = memo(function AgentCreatePane({
	agents,
	availableTools,
}: AgentCreatePaneProps) {
	const closeCreateModal = useAgentsStore((s) => s.closeCreateModal);
	const updateAgent = useUpdateAgent();
	const nameId = useId();
	const duplicateId = useId();
	const promptId = useId();

	const [name, setName] = useState('');
	const [prompt, setPrompt] = useState(BLANK_AGENT_PROMPT);
	const [preset, setPreset] = useState<keyof typeof TOOL_PRESETS>('planning');
	const [duplicateFrom, setDuplicateFrom] = useState('');
	const [scope, setScope] = useState<'local' | 'global'>('local');
	const [provider, setProvider] = useState('');
	const [model, setModel] = useState('');
	const [copyPrompt, setCopyPrompt] = useState(true);
	const [copyTools, setCopyTools] = useState(true);
	const [copyModelSettings, setCopyModelSettings] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const duplicateSource = duplicateFrom
		? agents.find((a) => a.name === duplicateFrom)
		: undefined;

	const selectedTools = useMemo(() => {
		const base = new Set(toolNamesFromConfig(TOOL_PRESETS[preset].tools));
		for (const t of REQUIRED_TOOLS) base.add(t);
		return Array.from(base).sort();
	}, [preset]);

	const resetForm = () => {
		setName('');
		setPrompt(BLANK_AGENT_PROMPT);
		setPreset('planning');
		setDuplicateFrom('');
		setScope('local');
		setProvider('');
		setModel('');
		setCopyPrompt(true);
		setCopyTools(true);
		setCopyModelSettings(false);
		setError(null);
	};

	const handleClose = () => {
		if (updateAgent.isPending) return;
		closeCreateModal();
		resetForm();
	};

	const applyDuplicate = (sourceName: string) => {
		setDuplicateFrom(sourceName);
		setProvider('');
		setModel('');
		if (!sourceName) return;
		const source = agents.find((a) => a.name === sourceName);
		if (!source) return;
		if (!name.trim()) setName(suggestAgentName(source.name, agents));
		if (copyPrompt) setPrompt(source.prompt || BLANK_AGENT_PROMPT);
	};

	const toggleCopyPrompt = (enabled: boolean) => {
		setCopyPrompt(enabled);
		if (!duplicateSource) return;
		setPrompt(
			enabled
				? duplicateSource.prompt || BLANK_AGENT_PROMPT
				: BLANK_AGENT_PROMPT,
		);
	};

	const toggleCopyModelSettings = (enabled: boolean) => {
		setCopyModelSettings(enabled);
		if (!enabled || !duplicateSource) {
			setProvider('');
			setModel('');
			return;
		}
		setProvider(duplicateSource.provider ?? '');
		setModel(duplicateSource.model ?? '');
	};

	const handleCreate = () => {
		const trimmed = name.trim();
		if (!trimmed) {
			setError('Agent name is required.');
			return;
		}
		if (!AGENT_NAME_RE.test(trimmed)) {
			setError('Use letters, numbers, underscores, and dashes only.');
			return;
		}
		if (agents.some((a) => a.name === trimmed)) {
			setError(`An agent named "${trimmed}" already exists.`);
			return;
		}

		const toolNames =
			duplicateSource && copyTools
				? Array.from(
						new Set([
							...toolNamesFromConfig(duplicateSource.toolConfig),
							...REQUIRED_TOOLS,
						]),
					).sort()
				: selectedTools;
		const tools = buildAgentToolConfig(toolNames, availableTools);

		setError(null);
		updateAgent.mutate(
			{
				name: trimmed,
				input: {
					scope,
					prompt,
					promptStorage: 'file',
					tools,
					provider: provider.trim() || null,
					model: model.trim() || null,
				},
			},
			{
				onSuccess: () => {
					resetForm();
					closeCreateModal();
				},
				onError: (err) => {
					setError(String(err));
				},
			},
		);
	};

	return (
		<>
			<div className="shrink-0 border-b border-border px-6 py-4">
				<button
					type="button"
					onClick={handleClose}
					className="-ml-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
				>
					<ArrowLeft className="h-3.5 w-3.5 shrink-0" />
					All agents
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
				<div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
					<div className="space-y-5">
						<div>
							<label
								htmlFor={nameId}
								className="text-xs font-medium text-muted-foreground"
							>
								Name
							</label>
							<input
								id={nameId}
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="reviewer"
								className={`${FIELD_CLASS} mt-1.5 font-mono`}
							/>
						</div>

						<div>
							<label
								htmlFor={duplicateId}
								className="text-xs font-medium text-muted-foreground"
							>
								Start from
							</label>
							<select
								id={duplicateId}
								value={duplicateFrom}
								onChange={(e) => applyDuplicate(e.target.value)}
								className={`${FIELD_CLASS} mt-1.5`}
							>
								<option value="">Blank template</option>
								{agents.map((a) => (
									<option key={a.name} value={a.name}>
										Duplicate {a.name}
									</option>
								))}
							</select>
							{duplicateSource ? (
								<div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={copyPrompt}
											onChange={(e) => toggleCopyPrompt(e.target.checked)}
										/>
										Copy prompt
									</label>
									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={copyTools}
											onChange={(e) => setCopyTools(e.target.checked)}
										/>
										Copy enabled tools
									</label>
									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={copyModelSettings}
											onChange={(e) =>
												toggleCopyModelSettings(e.target.checked)
											}
										/>
										Copy provider/model overrides
									</label>
								</div>
							) : null}
						</div>

						<div>
							<span className="text-xs font-medium text-muted-foreground">
								Scope
							</span>
							<div className="mt-1.5 flex gap-2">
								{(['local', 'global'] as const).map((value) => (
									<button
										type="button"
										key={value}
										onClick={() => setScope(value)}
										className={`flex-1 rounded-md border px-3 py-1.5 text-xs capitalize transition-colors ${
											scope === value
												? 'border-primary bg-primary/10 text-foreground'
												: 'border-border hover:bg-muted'
										}`}
									>
										{value}
									</button>
								))}
							</div>
							<p className="mt-1.5 text-[11px] text-muted-foreground">
								{scope === 'local'
									? 'Saved to this project under .otto/agents.'
									: 'Saved globally for all projects.'}
							</p>
						</div>

						<div>
							<span className="text-xs font-medium text-muted-foreground">
								Provider/model override
							</span>
							<div className="mt-1.5">
								<AgentProviderModelFields
									provider={provider}
									model={model}
									onProviderChange={setProvider}
									onModelChange={setModel}
									disabled={updateAgent.isPending}
								/>
							</div>
						</div>

						{!duplicateFrom && (
							<div>
								<span className="text-xs font-medium text-muted-foreground">
									Tool preset
								</span>
								<div className="mt-2 flex flex-wrap gap-2">
									{(
										Object.keys(TOOL_PRESETS) as Array<
											keyof typeof TOOL_PRESETS
										>
									).map((key) => (
										<button
											type="button"
											key={key}
											onClick={() => setPreset(key)}
											className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
												preset === key
													? 'border-primary bg-primary/10 text-foreground'
													: 'border-border hover:bg-muted'
											}`}
										>
											{TOOL_PRESETS[key].label}
										</button>
									))}
								</div>
								<p className="mt-2 text-[11px] text-muted-foreground">
									{selectedTools.length} tools included. Adjust them after
									creating.
								</p>
							</div>
						)}
					</div>

					<div className="flex min-h-0 flex-col">
						<label
							htmlFor={promptId}
							className="text-xs font-medium text-muted-foreground"
						>
							Prompt
						</label>
						<textarea
							id={promptId}
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							className="mt-1.5 min-h-[24rem] flex-1 resize-none rounded-md bg-muted/30 p-4 text-sm leading-relaxed font-mono outline-none ring-1 ring-border focus:ring-primary/50 transition-shadow"
						/>
						<p className="mt-1.5 text-[11px] text-muted-foreground">
							Saved to{' '}
							<code className="bg-muted px-1 rounded">
								{scope === 'global' ? '~/.otto/agents/' : '.otto/agents/'}
								{name.trim() || '…'}/agent.md
							</code>
						</p>
					</div>
				</div>
			</div>

			<div className="shrink-0 border-t border-border px-6 py-3 flex items-center justify-between gap-3">
				<p className="text-xs text-destructive">{error ?? ''}</p>
				<div className="flex gap-2">
					<Button variant="ghost" size="sm" onClick={handleClose}>
						Cancel
					</Button>
					<Button
						size="sm"
						onClick={handleCreate}
						disabled={updateAgent.isPending}
					>
						{updateAgent.isPending ? 'Creating…' : 'Create agent'}
					</Button>
				</div>
			</div>
		</>
	);
});
