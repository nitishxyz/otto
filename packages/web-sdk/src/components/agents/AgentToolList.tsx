import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Plus, Search, X, Zap } from 'lucide-react';
import type { ToolDetail } from '../../hooks/useAgents';
import {
	formatToolCategory,
	REQUIRED_TOOLS,
	RISKY_TOOLS,
	toolCategoryFromName,
	type ToolDisplay,
} from './agentConstants';

interface AgentToolListProps {
	selectedToolNames: Set<string>;
	toolBuckets: Record<string, ToolBucket>;
	availableTools: ToolDetail[];
	onToggle: (tool: ToolDisplay) => void;
	onMoveTool: (tool: ToolDisplay, bucket: ToolBucket) => void;
	disabled?: boolean;
}

export type ToolBucket = 'first_class' | 'loadable';

function bucketForTool(tool: ToolDisplay): ToolBucket {
	if (tool.activation === 'loadable') return 'loadable';
	if (tool.category === 'Loadable tools') return 'loadable';
	return 'first_class';
}

const BUCKET_META: Record<ToolBucket, { title: string; hint: string }> = {
	first_class: {
		title: 'First-class tools',
		hint: 'Always available to the agent.',
	},
	loadable: {
		title: 'Loadable tools',
		hint: 'Loaded on demand via load_tools.',
	},
};

export const AgentToolList = memo(function AgentToolList({
	selectedToolNames,
	toolBuckets,
	availableTools,
	onToggle,
	onMoveTool,
	disabled,
}: AgentToolListProps) {
	const toolDisplays = useMemo(() => {
		const byName = new Map(availableTools.map((tool) => [tool.name, tool]));
		const displays: ToolDisplay[] = [];
		const seen = new Set<string>();

		for (const detail of availableTools) {
			seen.add(detail.name);
			const overrideBucket = toolBuckets[detail.name];
			displays.push({
				name: detail.name,
				enabled: selectedToolNames.has(detail.name),
				category: overrideBucket
					? formatToolCategory(overrideBucket)
					: formatToolCategory(detail.category),
				activation: overrideBucket ?? detail.activation,
				description: detail.description,
				required: detail.required ?? REQUIRED_TOOLS.has(detail.name),
				risky: detail.risky ?? RISKY_TOOLS.has(detail.name),
				available: detail.available,
			});
		}

		for (const name of selectedToolNames) {
			if (seen.has(name)) continue;
			const detail = byName.get(name);
			const overrideBucket = toolBuckets[name];
			displays.push({
				name,
				enabled: true,
				category: overrideBucket
					? formatToolCategory(overrideBucket)
					: detail
						? formatToolCategory(detail.category)
						: toolCategoryFromName(name),
				activation: overrideBucket ?? detail?.activation,
				description: detail?.description,
				required: detail?.required ?? REQUIRED_TOOLS.has(name),
				risky: detail?.risky ?? RISKY_TOOLS.has(name),
				available: detail?.available ?? false,
			});
		}

		return displays;
	}, [availableTools, selectedToolNames, toolBuckets]);

	const buckets = useMemo(() => {
		const result: Record<ToolBucket, ToolDisplay[]> = {
			first_class: [],
			loadable: [],
		};
		for (const tool of toolDisplays) result[bucketForTool(tool)].push(tool);
		for (const key of Object.keys(result) as ToolBucket[]) {
			result[key].sort((a, b) => a.name.localeCompare(b.name));
		}
		return result;
	}, [toolDisplays]);

	const enabledCount = selectedToolNames.size;

	const toolsByName = useMemo(() => {
		const map = new Map<string, ToolDisplay>();
		for (const tool of toolDisplays) map.set(tool.name, tool);
		return map;
	}, [toolDisplays]);

	const handleDropName = (name: string, bucket: ToolBucket) => {
		if (disabled) return;
		const tool = toolsByName.get(name);
		if (!tool || tool.required) return;
		if (!tool.enabled) onToggle(tool);
		onMoveTool(tool, bucket);
	};

	return (
		<div className="space-y-5">
			<p className="text-xs text-muted-foreground">
				{enabledCount} {enabledCount === 1 ? 'tool' : 'tools'} enabled. Drag a
				tool between columns, or add one from the column picker. Required tools
				stay on.
			</p>
			<div className="grid gap-4 lg:grid-cols-2">
				{(Object.keys(BUCKET_META) as ToolBucket[]).map((bucket) => (
					<ToolColumn
						key={bucket}
						bucket={bucket}
						tools={buckets[bucket]}
						disabled={disabled}
						onToggle={onToggle}
						onDropName={handleDropName}
					/>
				))}
			</div>
		</div>
	);
});

const ToolColumn = memo(function ToolColumn({
	bucket,
	tools,
	disabled,
	onToggle,
	onDropName,
}: {
	bucket: ToolBucket;
	tools: ToolDisplay[];
	disabled?: boolean;
	onToggle: (tool: ToolDisplay) => void;
	onDropName: (name: string, bucket: ToolBucket) => void;
}) {
	const meta = BUCKET_META[bucket];
	const [isDragOver, setIsDragOver] = useState(false);
	const [picking, setPicking] = useState(false);

	const selected = tools.filter((t) => t.enabled);
	const available = tools.filter((t) => !t.enabled);

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(false);
		const name = e.dataTransfer.getData('text/tool-name');
		if (name) onDropName(name, bucket);
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: column is an HTML5 drag-and-drop target; tool add/remove is also available via the picker and card buttons.
		<div
			className={`flex min-h-[220px] flex-col gap-3 rounded-xl border p-3.5 transition-colors ${
				isDragOver
					? 'border-primary/50 bg-primary/10 ring-1 ring-primary/30'
					: 'border-border bg-muted/30'
			}`}
			onDragOver={(e) => {
				if (disabled) return;
				e.preventDefault();
				setIsDragOver(true);
			}}
			onDragLeave={() => setIsDragOver(false)}
			onDrop={handleDrop}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="flex items-center gap-1.5">
						<Zap className="h-3.5 w-3.5 text-primary" />
						<h4 className="text-sm font-semibold text-foreground">
							{meta.title}
						</h4>
					</div>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						{meta.hint}
					</p>
				</div>
				<span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground ring-1 ring-border">
					{selected.length}
				</span>
			</div>

			<div className="flex flex-col gap-2">
				{picking ? (
					<ToolPicker
						available={available}
						disabled={disabled}
						onPick={(tool) => onToggle(tool)}
						onClose={() => setPicking(false)}
					/>
				) : (
					<button
						type="button"
						disabled={disabled}
						onClick={() => setPicking(true)}
						className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background/50 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Plus className="h-3.5 w-3.5" />
						{available.length === 0
							? 'Add tool'
							: `Add tool (${available.length})`}
					</button>
				)}

				{selected.map((tool) => (
					<ToolCard
						key={tool.name}
						tool={tool}
						disabled={disabled}
						onRemove={() => onToggle(tool)}
					/>
				))}
			</div>
		</div>
	);
});

const ToolPicker = memo(function ToolPicker({
	available,
	disabled,
	onPick,
	onClose,
}: {
	available: ToolDisplay[];
	disabled?: boolean;
	onPick: (tool: ToolDisplay) => void;
	onClose: () => void;
}) {
	const [query, setQuery] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return available;
		return available.filter(
			(t) =>
				t.name.toLowerCase().includes(q) ||
				(t.description ?? '').toLowerCase().includes(q),
		);
	}, [available, query]);

	return (
		<div className="rounded-md border border-border bg-background/60 p-2">
			<div className="relative">
				<Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search tools..."
					className="h-8 w-full rounded-md border border-border bg-muted/40 pl-8 pr-7 text-xs outline-none focus:border-foreground/20"
				/>
				<button
					type="button"
					onClick={onClose}
					className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
					aria-label="Close picker"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>
			<div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
				{filtered.length === 0 ? (
					<p className="px-1 py-3 text-center text-[11px] text-muted-foreground">
						{available.length === 0 ? 'All tools added.' : 'No tools match.'}
					</p>
				) : (
					filtered.map((tool) => (
						<button
							type="button"
							key={tool.name}
							disabled={disabled}
							onClick={() => onPick(tool)}
							className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
							<span className="truncate font-mono text-xs">{tool.name}</span>
							{tool.risky && (
								<span className="ml-auto shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
									risky
								</span>
							)}
						</button>
					))
				)}
			</div>
		</div>
	);
});

const ToolCard = memo(function ToolCard({
	tool,
	disabled,
	onRemove,
}: {
	tool: ToolDisplay;
	disabled?: boolean;
	onRemove: () => void;
}) {
	const draggable = !disabled && !tool.required;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: card is an HTML5 drag source for moving tools; removal is available via the explicit remove button.
		<div
			draggable={draggable}
			onDragStart={(e) => {
				if (!draggable) return;
				e.dataTransfer.setData('text/tool-name', tool.name);
				e.dataTransfer.effectAllowed = 'move';
			}}
			className={`group relative flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2.5 shadow-sm transition-colors hover:border-foreground/20 ${
				draggable ? 'cursor-grab active:cursor-grabbing' : ''
			}`}
		>
			{draggable ? (
				<GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
			) : (
				<span className="mt-0.5 h-4 w-4 shrink-0" />
			)}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span className="truncate font-mono text-sm font-medium text-foreground">
						{tool.name}
					</span>
					{tool.required && (
						<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
							required
						</span>
					)}
					{tool.risky && (
						<span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
							risky
						</span>
					)}
					{tool.available === false && (
						<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
							unavailable
						</span>
					)}
				</div>
				{tool.description ? (
					<p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
						{tool.description}
					</p>
				) : null}
			</div>
			{!tool.required && (
				<button
					type="button"
					disabled={disabled}
					onClick={onRemove}
					aria-label={`Remove ${tool.name}`}
					className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			)}
		</div>
	);
});
