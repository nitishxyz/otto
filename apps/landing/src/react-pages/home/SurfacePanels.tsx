import { NeoBadge, NeoBox } from '../../components/neopop';

function Chrome({
	label,
	children,
	accent = 'bg-np-lime',
}: {
	label: string;
	children: React.ReactNode;
	accent?: string;
}) {
	return (
		<NeoBox
			elevation="md"
			tone="surface"
			className="flex h-full min-h-[340px] flex-col overflow-hidden"
		>
			<div className="flex shrink-0 items-center gap-2 border-b-2 border-otto-border bg-otto-card px-3 py-2">
				<span className={`h-2.5 w-2.5 shrink-0 ${accent}`} />
				<span className="truncate text-[11px] font-medium text-otto-muted">
					{label}
				</span>
			</div>
			<div className="min-h-0 flex-1">{children}</div>
		</NeoBox>
	);
}

export function TuiPanel() {
	return (
		<Chrome label="otto — ~/acme-api">
			<div className="flex h-full flex-col gap-3 p-4 text-[12px] leading-relaxed sm:text-[13px]">
				<div className="flex flex-wrap items-center gap-2 border-b-2 border-otto-border pb-3">
					<NeoBadge tone="lime" size="sm">
						build
					</NeoBadge>
					<span className="text-[11px] text-otto-dim">claude-sonnet-4</span>
					<span className="ml-auto text-[11px] text-otto-dim">12.4k ctx</span>
				</div>
				<p className="ml-auto w-fit max-w-[88%] border-2 border-otto-border bg-otto-card px-2.5 py-1.5 text-otto-text rounded-[3px]">
					add validation to the checkout route and run its tests
				</p>
				<div className="space-y-1 text-otto-dim">
					<p>↳ search · checkout · 8 matches</p>
					<p>↳ apply_patch · routes/checkout.ts · +21 −5</p>
					<p>↳ shell · bun test checkout · 18 passed</p>
				</div>
				<p className="text-otto-text">
					Validation is in place and all 18 checkout tests pass.
				</p>
				<div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t-2 border-otto-border pt-3 text-[10px] text-otto-dim">
					<span>/models</span>
					<span>/agents</span>
					<span>/approvals</span>
					<span>/share</span>
				</div>
			</div>
		</Chrome>
	);
}

export function CliPanel() {
	return (
		<Chrome label="~/acme-api — otto ask" accent="bg-np-coral">
			<div className="flex h-full flex-col gap-1.5 p-4 text-[12px] leading-relaxed sm:text-[13px]">
				<p className="text-otto-text">
					<span className="text-np-blue">$</span> otto ask "why is the nightly
					job timing out?"
				</p>
				<p className="text-otto-dim">↳ search · jobs/nightly.ts · 3 matches</p>
				<p className="text-otto-dim">↳ read · jobs/nightly.ts</p>
				<p className="text-otto-dim">↳ apply_patch · +12 −3</p>
				<p className="text-otto-text">
					The batch size was unbounded. Chunked it at 500 and the job finishes
					in 40s.
				</p>
				<p className="mt-auto pt-1 text-otto-text">
					<span className="text-np-blue">$</span>{' '}
					<span className="animate-blink">▋</span>
				</p>
			</div>
		</Chrome>
	);
}

export function WebPanel() {
	return (
		<Chrome label="localhost:3000 — otto web" accent="bg-np-blue">
			<div className="grid h-full grid-cols-[92px_1fr] sm:grid-cols-[120px_1fr]">
				<div className="space-y-1.5 border-r-2 border-otto-border bg-otto-card p-2.5">
					{['fix-checkout', 'add-sso', 'db-migration'].map((s, i) => (
						<div
							key={s}
							className={`truncate px-1.5 py-1 text-[10px] rounded-[3px] ${
								i === 0
									? 'bg-np-blue text-np-blue-on font-medium'
									: 'text-otto-dim'
							}`}
						>
							{s}
						</div>
					))}
				</div>
				<div className="flex h-full flex-col gap-2.5 p-3">
					<div className="ml-auto w-fit max-w-[85%] border-2 border-otto-border bg-otto-card px-2.5 py-1.5 text-[11px] text-otto-text rounded-[3px]">
						split the checkout route
					</div>
					<div className="space-y-1 text-[11px] text-otto-dim">
						<p>↳ write · routes/checkout/index.ts</p>
						<p>↳ write · routes/checkout/tax.ts</p>
					</div>
					<p className="text-[11px] leading-relaxed text-otto-text">
						Split into three modules and kept the public export stable.
					</p>
					<div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t-2 border-otto-border pt-2 text-[10px] text-otto-dim">
						<span>git</span>
						<span>files</span>
						<span>terminals</span>
						<span>preview</span>
					</div>
				</div>
			</div>
		</Chrome>
	);
}

export function DesktopPanel() {
	return (
		<Chrome label="otto — Desktop" accent="bg-np-yellow">
			<div className="grid h-full grid-cols-[76px_1fr] sm:grid-cols-[104px_1fr]">
				<div className="space-y-2 border-r-2 border-otto-border bg-otto-card p-2.5">
					<div className="h-2 w-full bg-otto-border" />
					<div className="h-2 w-3/4 bg-otto-border" />
					<div className="h-2 w-5/6 bg-otto-border" />
					<div className="mt-3 h-6 w-full border-2 border-otto-border bg-np-yellow rounded-[3px]" />
				</div>
				<div className="flex h-full flex-col gap-3 p-4">
					<div className="flex flex-wrap items-center gap-2">
						<NeoBadge tone="yellow" size="sm">
							Native
						</NeoBadge>
						<NeoBadge outline size="sm">
							macOS
						</NeoBadge>
						<NeoBadge outline size="sm">
							Linux
						</NeoBadge>
					</div>
					<p className="text-[12px] leading-relaxed text-otto-muted">
						The full otto workspace in a native window — project switching,
						session history, git changes, and local or remote projects.
					</p>
					<div className="mt-auto space-y-1 border-t-2 border-otto-border pt-3 text-[11px] text-otto-dim">
						<p>⌘N · new session</p>
						<p>⌘P · quick file picker</p>
						<p>⌘J · toggle terminal</p>
					</div>
				</div>
			</div>
		</Chrome>
	);
}
