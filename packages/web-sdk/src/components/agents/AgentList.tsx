import { memo, useMemo } from 'react';
import { Bot, CheckCircle2, Plus, Search, X } from 'lucide-react';
import { getAgentToolCount, type AgentDetail } from '../../hooks/useAgents';
import { useAgentsStore } from '../../stores/agentsStore';
import { Button } from '../ui/Button';

interface AgentListProps {
	agents: AgentDetail[];
	defaultAgent: string | null;
	searchQuery: string;
	onSearchChange: (value: string) => void;
}

export const AgentList = memo(function AgentList({
	agents,
	defaultAgent,
	searchQuery,
	onSearchChange,
}: AgentListProps) {
	const openAgentInManager = useAgentsStore((s) => s.openAgentInManager);
	const openCreateModal = useAgentsStore((s) => s.openCreateModal);

	const filteredAgents = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return agents;
		return agents.filter(
			(agent) =>
				agent.name.toLowerCase().includes(q) ||
				(agent.provider ?? '').toLowerCase().includes(q) ||
				(agent.model ?? '').toLowerCase().includes(q),
		);
	}, [agents, searchQuery]);

	const builtInAgents = filteredAgents.filter((a) => a.builtin);
	const customAgents = filteredAgents.filter((a) => !a.builtin);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="border-b border-sidebar-border/60 px-3 py-2">
				<Button
					variant="secondary"
					size="sm"
					onClick={openCreateModal}
					className="h-8 w-full gap-2 text-xs"
				>
					<Plus className="h-3.5 w-3.5" />
					New agent
				</Button>
			</div>

			<div className="px-2 py-2 border-b border-sidebar-border/60">
				<div className="relative">
					<Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
					<input
						type="text"
						value={searchQuery}
						onChange={(event) => onSearchChange(event.target.value)}
						placeholder="Search agents..."
						className="w-full h-8 pl-7 pr-7 text-[12px] bg-muted/40 border border-sidebar-border/60 rounded-md outline-none focus:border-foreground/20 placeholder:text-muted-foreground"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => onSearchChange('')}
							className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
							title="Clear search"
						>
							<X className="w-3 h-3" />
						</button>
					)}
				</div>
			</div>

			<div className="flex-1 overflow-y-auto py-1">
				{filteredAgents.length === 0 ? (
					<div className="flex flex-col items-center justify-center px-4 py-10 text-center">
						<Bot className="mb-3 h-10 w-10 text-muted-foreground/30" />
						<p className="text-sm font-medium">No agents found</p>
						<p className="mt-1 max-w-[220px] text-xs text-muted-foreground">
							{searchQuery
								? `No agents match "${searchQuery}".`
								: 'Create a custom agent to get started.'}
						</p>
					</div>
				) : (
					<>
						{defaultAgent && (
							<div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
								Default · {defaultAgent}
							</div>
						)}
						{builtInAgents.length > 0 && (
							<AgentGroup
								title="Built-in"
								agents={builtInAgents}
								defaultAgent={defaultAgent}
								onSelect={openAgentInManager}
							/>
						)}
						{customAgents.length > 0 && (
							<AgentGroup
								title="Custom"
								agents={customAgents}
								defaultAgent={defaultAgent}
								onSelect={openAgentInManager}
							/>
						)}
					</>
				)}
			</div>
		</div>
	);
});

const AgentGroup = memo(function AgentGroup({
	title,
	agents,
	defaultAgent,
	onSelect,
}: {
	title: string;
	agents: AgentDetail[];
	defaultAgent: string | null;
	onSelect: (name: string) => void;
}) {
	return (
		<div>
			<div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
				{title}
			</div>
			{agents.map((agent) => (
				<button
					type="button"
					key={agent.name}
					onClick={() => onSelect(agent.name)}
					className="w-full text-left px-3 py-2.5 hover:bg-accent transition-colors"
				>
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium truncate flex-1">
							{agent.name}
						</span>
						{agent.name === defaultAgent && (
							<CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
						)}
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
						<span className="px-1.5 py-0.5 rounded bg-muted">
							{agent.builtin ? 'built-in' : 'custom'}
						</span>
						<span>{getAgentToolCount(agent)} tools</span>
						{(agent.provider || agent.model) && (
							<span className="font-mono truncate max-w-[140px]">
								{[agent.provider, agent.model].filter(Boolean).join(' / ')}
							</span>
						)}
					</div>
				</button>
			))}
		</div>
	);
});
