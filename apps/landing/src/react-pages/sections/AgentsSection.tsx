import { Reveal } from '../../components/Reveal';

const AGENTS = [
	{
		name: 'build',
		color: 'text-green-700 dark:text-green-400',
		desc: 'Code generation, bug fixes, features. Full filesystem + shell access.',
		tools: ['read', 'write', 'shell', 'git', 'terminal', 'apply_patch'],
	},
	{
		name: 'plan',
		color: 'text-blue-700 dark:text-blue-400',
		desc: 'Architecture planning and analysis. Read-only — cannot modify files.',
		tools: ['read', 'ls', 'tree', 'search', 'websearch'],
	},
	{
		name: 'general',
		color: 'text-yellow-400',
		desc: 'General-purpose assistant. Balanced toolset for everyday work.',
		tools: ['read', 'write', 'shell', 'search', 'glob'],
	},
	{
		name: 'research',
		color: 'text-purple-700 dark:text-purple-400',
		desc: 'Deep research across sessions and the web. Queries past context.',
		tools: ['read', 'search', 'websearch', 'query_sessions'],
	},
];

export function AgentsSection() {
	return (
		<section className="py-28 sm:py-36 px-6 border-t border-otto-border">
			<div className="max-w-[1100px] mx-auto">
				<Reveal>
					<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-4">
						Agents
					</p>
					<h2 className="text-2xl sm:text-3xl font-bold mb-16 max-w-sm">
						Purpose-built agents
					</h2>
				</Reveal>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{AGENTS.map((a, i) => (
						<Reveal key={a.name} delay={i * 60}>
							<div className="bg-otto-surface border border-otto-border rounded-lg p-6">
								<div className="flex items-center gap-2.5 mb-3">
									<span className={`text-sm font-bold ${a.color}`}>
										{a.name}
									</span>
									<span className="text-otto-dim text-[10px] uppercase tracking-wider">
										agent
									</span>
								</div>
								<p className="text-otto-muted text-sm leading-relaxed mb-4">
									{a.desc}
								</p>
								<div className="flex flex-wrap gap-1.5">
									{a.tools.map((t) => (
										<span
											key={t}
											className="px-2 py-0.5 text-[10px] bg-otto-bg border border-otto-border rounded text-otto-dim"
										>
											{t}
										</span>
									))}
								</div>
							</div>
						</Reveal>
					))}
				</div>
			</div>
		</section>
	);
}
