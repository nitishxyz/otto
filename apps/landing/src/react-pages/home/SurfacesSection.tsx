import { useId, useState } from 'react';
import {
	NeoBox,
	NeoEyebrow,
	NeoReveal,
	NeoSection,
	cn,
	type NeoTone,
} from '../../components/neopop';
import { BrowserIcon, DownloadIcon, SparkIcon, TerminalIcon } from './icons';
import { CliPanel, DesktopPanel, TuiPanel, WebPanel } from './SurfacePanels';

type Surface = {
	id: string;
	label: string;
	blurb: string;
	tone: NeoTone;
	icon: (p: { className?: string }) => React.ReactElement;
	panel: () => React.ReactElement;
};

const SURFACES: Surface[] = [
	{
		id: 'tui',
		label: 'TUI',
		blurb: 'A full interactive coding session without leaving your terminal.',
		tone: 'lime',
		icon: TerminalIcon,
		panel: TuiPanel,
	},
	{
		id: 'cli',
		label: 'CLI',
		blurb: 'Run one focused task from a prompt, script, or CI workflow.',
		tone: 'coral',
		icon: SparkIcon,
		panel: CliPanel,
	},
	{
		id: 'browser',
		label: 'Browser',
		blurb:
			'Sessions, git, files, terminals, and previews in a local web workspace.',
		tone: 'blue',
		icon: BrowserIcon,
		panel: WebPanel,
	},
	{
		id: 'app',
		label: 'Desktop',
		blurb:
			'A native workspace for local folders and connected remote projects.',
		tone: 'yellow',
		icon: DownloadIcon,
		panel: DesktopPanel,
	},
];

const TAB_ACTIVE: Record<string, string> = {
	blue: 'bg-np-blue text-np-blue-on',
	lime: 'bg-np-lime text-np-lime-on',
	yellow: 'bg-np-yellow text-np-yellow-on',
	coral: 'bg-np-coral text-np-coral-on',
};

export function SurfacesSection() {
	const [active, setActive] = useState(0);
	const baseId = useId();
	const current = SURFACES[active] ?? SURFACES[0];
	if (!current) return null;
	const Panel = current.panel;

	const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
		const last = SURFACES.length - 1;
		let next: number | null = null;
		if (e.key === 'ArrowRight') next = active === last ? 0 : active + 1;
		else if (e.key === 'ArrowLeft') next = active === 0 ? last : active - 1;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = last;
		if (next === null) return;
		e.preventDefault();
		setActive(next);
		const id = SURFACES[next]?.id;
		if (id) document.getElementById(`${baseId}-tab-${id}`)?.focus();
	};

	return (
		<NeoSection id="surfaces" aria-labelledby="surfaces-title">
			<div className="py-16 sm:py-24">
				<NeoReveal>
					<div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
						<div>
							<NeoEyebrow>Where it runs</NeoEyebrow>
							<h2
								id="surfaces-title"
								className="np-title mt-4 max-w-[14ch] text-otto-text"
							>
								One agent, every surface.
							</h2>
						</div>
						<p className="max-w-[38ch] text-[14px] leading-relaxed text-otto-muted">
							Same sessions, same history, same tools. Start in the terminal,
							pick it back up in the browser or the desktop app.
						</p>
					</div>
				</NeoReveal>

				<NeoReveal delay={80}>
					<div
						role="tablist"
						aria-label="otto surfaces"
						className="mt-9 grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
					>
						{SURFACES.map((s, i) => {
							const Icon = s.icon;
							const selected = i === active;
							return (
								<button
									key={s.id}
									type="button"
									role="tab"
									id={`${baseId}-tab-${s.id}`}
									aria-selected={selected}
									aria-controls={`${baseId}-panel-${s.id}`}
									tabIndex={selected ? 0 : -1}
									onKeyDown={onTabKeyDown}
									onClick={() => setActive(i)}
									className={cn(
										'inline-flex h-11 w-full items-center justify-center gap-2 border-2 border-otto-border px-3 py-2',
										'text-[12px] font-semibold tracking-tight rounded-[3px]',
										'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-np-blue focus-visible:ring-offset-2 focus-visible:ring-offset-otto-bg',
										selected
											? cn(TAB_ACTIVE[s.tone], 'np-shadow-sm')
											: 'bg-otto-surface text-otto-muted hover:text-otto-text transition-colors duration-150',
									)}
								>
									<Icon className="h-3.5 w-3.5" />
									{s.label}
								</button>
							);
						})}
					</div>
				</NeoReveal>

				<NeoReveal delay={120}>
					<div
						role="tabpanel"
						id={`${baseId}-panel-${current.id}`}
						aria-labelledby={`${baseId}-tab-${current.id}`}
						className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:items-stretch"
					>
						<div className="min-w-0 order-2 h-full lg:order-1">
							<Panel />
						</div>

						<NeoBox
							tone="card"
							elevation="sm"
							className="order-1 h-full p-5 lg:order-2"
						>
							<h3 className="text-[16px] font-semibold tracking-tight text-otto-text">
								{current.label}
							</h3>
							<p className="mt-2 text-[13px] leading-relaxed text-otto-muted">
								{current.blurb}
							</p>
							<ul className="mt-4 space-y-2 border-t-2 border-otto-border pt-4">
								{SURFACES.filter((_, i) => i !== active).map((s) => (
									<li key={s.id}>
										<button
											type="button"
											onClick={() =>
												setActive(SURFACES.findIndex((x) => x.id === s.id))
											}
											className="w-full text-left text-[12px] text-otto-dim transition-colors duration-150 hover:text-otto-text"
										>
											{s.label} — {s.blurb}
										</button>
									</li>
								))}
							</ul>
						</NeoBox>
					</div>
				</NeoReveal>
			</div>
		</NeoSection>
	);
}
