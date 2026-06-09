import { Reveal } from '../../components/Reveal';

const TOOL_GROUPS = [
	{ cat: 'File', items: ['read', 'write', 'ls', 'tree', 'glob'] },
	{ cat: 'Search', items: ['search', 'glob', 'websearch'] },
	{ cat: 'Edit', items: ['edit', 'apply_patch'] },
	{ cat: 'Shell', items: ['shell', 'terminal'] },
	{ cat: 'Git', items: ['git_status', 'git_diff', 'git_commit'] },
	{ cat: 'Agent', items: ['progress_update', 'finish', 'update_todos'] },
	{ cat: 'MCP', items: ['github', 'linear', 'helius', 'notion', '+ any'] },
];

export function ToolsSection() {
	return (
		<section className="py-28 sm:py-36 px-6 border-t border-otto-border">
			<div className="max-w-[1100px] mx-auto">
				<Reveal>
					<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-4">
						Tools
					</p>
					<h2 className="text-2xl sm:text-3xl font-bold mb-16 max-w-sm">
						15+ built-in tools + MCP
					</h2>
				</Reveal>

				<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
					{TOOL_GROUPS.map((g, i) => (
						<Reveal key={g.cat} delay={i * 40}>
							<div>
								<span className="text-[10px] text-otto-dim uppercase tracking-wider">
									{g.cat}
								</span>
								<div className="mt-2 space-y-1">
									{g.items.map((t) => (
										<div key={t} className="text-sm text-otto-muted">
											{t}
										</div>
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
