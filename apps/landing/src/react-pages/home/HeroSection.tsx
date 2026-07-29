import {
	NeoBadge,
	NeoBox,
	NeoButton,
	NeoOttoLogo,
	NeoReveal,
} from '../../components/neopop';
import { CopyButton } from '../../components/CopyButton';
import { sectionLink } from '../../lib/section-link';
import { AgentMockup } from './AgentMockup';
import { DownloadIcon } from './icons';

const INSTALL_CMD = 'curl -fsSL https://install.ottocode.io | sh';

const PROOF = [
	{ label: 'Terminal', tone: 'lime' as const },
	{ label: 'Browser', tone: 'blue' as const },
	{ label: 'Desktop', tone: 'yellow' as const },
	{ label: 'Switch models', tone: 'coral' as const },
];

export function HeroSection() {
	return (
		<section className="relative w-full overflow-hidden pt-24 sm:pt-28">
			<div
				aria-hidden="true"
				className="np-grid-bg pointer-events-none absolute inset-0 opacity-60"
			/>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-otto-bg"
			/>

			<div className="relative mx-auto w-full max-w-[1080px] px-5 pb-14 sm:px-8 sm:pb-20 lg:px-12">
				<NeoReveal>
					<div className="mb-5 flex flex-wrap items-center gap-2">
						<NeoBadge tone="lime" elevated>
							Open source
						</NeoBadge>
						<NeoBadge outline size="md">
							MIT licensed
						</NeoBadge>
					</div>

					<h1 className="np-display max-w-[20ch] text-otto-text">
						<span className="block whitespace-nowrap">You describe it.</span>
						<span className="mt-[0.12em] block whitespace-nowrap">
							{/* The wordmark is sized in `em` so it tracks the display type, and
							    nudged down by the slice of its viewBox that sits below the
							    baseline (padding plus the hard extrusion). */}
							<NeoOttoLogo className="mr-[0.16em] inline-block h-[0.82em] w-auto align-[-0.08em]" />
							builds it.
						</span>
					</h1>

					<p className="mt-6 max-w-[52ch] text-[15px] leading-relaxed text-otto-muted sm:text-[17px]">
						otto reads your repo, edits files, runs your tests, and checks the
						result — from the terminal, your browser, or a native desktop app.
					</p>
				</NeoReveal>

				<NeoReveal delay={90}>
					<div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
						<NeoButton
							href="#install"
							onClick={sectionLink('install')}
							tone="blue"
							size="lg"
							data-s-event="Click install CTA"
							data-s-event-props="source=hero"
						>
							Install otto
						</NeoButton>
						<NeoButton
							href="#desktop"
							onClick={sectionLink('desktop')}
							tone="ink"
							size="lg"
							data-s-event="Click desktop CTA"
							data-s-event-props="source=hero"
						>
							<DownloadIcon className="h-4 w-4" />
							Get the desktop app
						</NeoButton>
						<NeoButton
							href="/docs"
							variant="outline"
							size="lg"
							data-s-event="Click docs CTA"
							data-s-event-props="source=hero"
						>
							Read the docs
						</NeoButton>
					</div>
				</NeoReveal>

				<NeoReveal delay={140}>
					<NeoBox
						elevation="sm"
						tone="card"
						className="mt-6 flex w-full max-w-[520px] items-center gap-2 py-2 pl-3 pr-2"
					>
						<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[12px] text-otto-text sm:text-[13px]">
							<span className="select-none text-otto-dim">$ </span>
							{INSTALL_CMD}
						</code>
						<CopyButton
							text={INSTALL_CMD}
							className="shrink-0"
							eventName="Copy install command"
							eventProps="source=hero;method=curl"
						/>
					</NeoBox>
				</NeoReveal>

				<NeoReveal delay={190}>
					<ul className="mt-5 flex flex-wrap items-center gap-2">
						{PROOF.map((p) => (
							<li key={p.label}>
								<NeoBadge tone={p.tone} size="sm">
									{p.label}
								</NeoBadge>
							</li>
						))}
					</ul>
				</NeoReveal>

				<NeoReveal delay={240} className="mt-12 sm:mt-16">
					<AgentMockup />
				</NeoReveal>
			</div>
		</section>
	);
}
