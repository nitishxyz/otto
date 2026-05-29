import { Reveal } from '../../components/Reveal';

const INTERFACES = [
	{
		tag: 'CLI',
		headline: 'Terminal-native',
		body: 'One-shot prompts or interactive sessions. Compiles to a single self-contained binary.',
		cmd: 'otto ask "fix the auth bug"',
	},
	{
		tag: 'TUI',
		headline: 'Interactive terminal UI',
		body: 'OpenTUI + React client for otto with keyboard-first workflows powered by @ottocode/api.',
		cmd: 'bun run --filter @ottocode/tui dev',
	},
	{
		tag: 'Server',
		headline: 'HTTP API + Web UI',
		body: 'Local Hono server with SSE streaming. React web interface with session management.',
		cmd: 'otto serve --port 3000',
	},
	{
		tag: 'Desktop',
		headline: 'Native app',
		body: 'Tauri v2 app that embeds the CLI binary and web UI. macOS and Linux.',
		cmd: 'otto',
	},
	{
		tag: 'Web',
		headline: 'Remote web client',
		body: 'Run only the Web UI and point it at an existing otto API server URL.',
		cmd: 'otto web --api <url>',
	},
	{
		tag: 'SDK',
		headline: 'Embed anywhere',
		body: 'Use @ottocode/server in your own apps. Provider-agnostic. Tree-shakable.',
		cmd: 'import { createEmbeddedApp }',
	},
];

export function InterfacesSection() {
	return (
		<section className="py-28 sm:py-36 px-6">
			<div className="max-w-[1100px] mx-auto">
				<Reveal>
					<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-4">
						Interfaces
					</p>
					<h2 className="text-2xl sm:text-3xl font-bold mb-16 max-w-md">
						One tool.
						<br />
						Every surface.
					</h2>
				</Reveal>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-otto-border rounded-lg overflow-hidden">
					{INTERFACES.map((item, i) => (
						<Reveal key={item.tag} delay={i * 80}>
							<div className="bg-otto-bg p-7 sm:p-8 h-full">
								<span className="text-[11px] text-otto-dim uppercase tracking-wider">
									{item.tag}
								</span>
								<h3 className="text-lg font-semibold mt-2 mb-2">
									{item.headline}
								</h3>
								<p className="text-otto-muted text-sm leading-relaxed mb-5">
									{item.body}
								</p>
								<code className="text-xs text-otto-dim bg-otto-surface px-3 py-1.5 rounded border border-otto-border inline-block">
									{item.cmd}
								</code>
							</div>
						</Reveal>
					))}
				</div>
			</div>
		</section>
	);
}
