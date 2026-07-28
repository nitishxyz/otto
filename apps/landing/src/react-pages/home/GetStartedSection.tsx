import { CopyButton } from '../../components/CopyButton';
import {
	NeoBadge,
	NeoBox,
	NeoButton,
	NeoEyebrow,
	NeoReveal,
	NeoSection,
} from '../../components/neopop';
import { useLatestRelease } from '../../hooks/useLatestRelease';
import { AppleIcon, DownloadIcon, LinuxIcon } from './icons';

const CURL_CMD = 'curl -fsSL https://install.ottocode.io | sh';
const BUN_CMD = 'bun install -g @ottocode/install';

function CommandCard({
	cmd,
	label,
	method,
}: {
	cmd: string;
	label: string;
	method: string;
}) {
	return (
		<div>
			<p className="np-eyebrow mb-2 text-otto-dim">{label}</p>
			<NeoBox
				tone="surface"
				elevation="md"
				className="flex items-center gap-2 py-2.5 pl-3 pr-2"
			>
				<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[12px] text-otto-text sm:text-[13px]">
					<span className="select-none text-otto-dim">$ </span>
					{cmd}
				</code>
				<CopyButton
					text={cmd}
					className="shrink-0"
					eventName="Copy install command"
					eventProps={`source=install;method=${method}`}
				/>
			</NeoBox>
		</div>
	);
}

function DownloadRow({
	href,
	title,
	format,
	size,
	eventProps,
}: {
	href: string;
	title: string;
	format: string;
	size: number;
	eventProps: string;
}) {
	return (
		<a
			href={href}
			className="group flex items-center justify-between gap-3 border-2 border-otto-border bg-otto-bg px-3 py-2.5 rounded-[3px] transition-colors duration-150 hover:bg-otto-text hover:text-otto-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-np-blue focus-visible:ring-offset-2 focus-visible:ring-offset-otto-bg"
			data-s-event="Download desktop app"
			data-s-event-props={eventProps}
		>
			<span className="flex min-w-0 items-center gap-2.5">
				<DownloadIcon className="h-3.5 w-3.5 shrink-0 text-otto-dim group-hover:text-otto-bg" />
				<span className="truncate text-[13px] font-medium">{title}</span>
				<span className="shrink-0 text-[11px] text-otto-dim group-hover:text-otto-bg">
					{format}
				</span>
			</span>
			<span className="shrink-0 text-[11px] text-otto-dim group-hover:text-otto-bg">
				{Math.round(size / 1024 / 1024)} MB
			</span>
		</a>
	);
}

function DesktopDownloads() {
	const { release } = useLatestRelease();

	return (
		<div>
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
				<NeoBox tone="surface" elevation="md" className="p-5">
					<div className="mb-4 flex items-center gap-3">
						<AppleIcon className="h-5 w-5 text-otto-text" />
						<h4 className="flex-1 text-[15px] font-semibold text-otto-text">
							macOS
						</h4>
						<NeoBadge outline size="sm">
							v{release.version}
						</NeoBadge>
					</div>
					<div className="space-y-2">
						{release.macosArm && (
							<DownloadRow
								href={release.macosArm.url}
								title="Apple Silicon"
								format=".dmg"
								size={release.macosArm.size}
								eventProps="platform=macos;arch=arm64;format=dmg"
							/>
						)}
						{release.macosIntel && (
							<DownloadRow
								href={release.macosIntel.url}
								title="Intel"
								format=".dmg"
								size={release.macosIntel.size}
								eventProps="platform=macos;arch=x64;format=dmg"
							/>
						)}
					</div>
				</NeoBox>

				<NeoBox tone="surface" elevation="md" className="p-5">
					<div className="mb-4 flex items-center gap-3">
						<LinuxIcon className="h-5 w-5 text-otto-text" />
						<h4 className="flex-1 text-[15px] font-semibold text-otto-text">
							Linux
						</h4>
						<NeoBadge outline size="sm">
							v{release.version}
						</NeoBadge>
					</div>
					<div className="space-y-2">
						{release.linuxDeb && (
							<DownloadRow
								href={release.linuxDeb.url}
								title="x86_64"
								format=".deb"
								size={release.linuxDeb.size}
								eventProps="platform=linux;arch=x64;format=deb"
							/>
						)}
						{release.linuxDebArm && (
							<DownloadRow
								href={release.linuxDebArm.url}
								title="ARM64"
								format=".deb"
								size={release.linuxDebArm.size}
								eventProps="platform=linux;arch=arm64;format=deb"
							/>
						)}
					</div>
					<p className="mt-3 text-[11px] text-otto-dim">
						Install with <code>sudo dpkg -i otto_*.deb</code>
					</p>
				</NeoBox>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
				<a
					href={`https://github.com/nitishxyz/otto/releases/tag/${release.tag}`}
					target="_blank"
					rel="noopener noreferrer"
					className="text-[12px] text-otto-dim underline-offset-2 transition-colors duration-150 hover:text-otto-text hover:underline"
					data-s-event="Click release notes"
					data-s-event-props="source=desktop"
				>
					Release notes →
				</a>
				<a
					href="https://github.com/nitishxyz/otto/releases"
					target="_blank"
					rel="noopener noreferrer"
					className="text-[12px] text-otto-dim underline-offset-2 transition-colors duration-150 hover:text-otto-text hover:underline"
					data-s-event="Click all releases"
					data-s-event-props="source=desktop"
				>
					All releases →
				</a>
			</div>
		</div>
	);
}

export function GetStartedSection() {
	return (
		<NeoSection id="install" aria-labelledby="install-title">
			<div className="py-16 sm:py-24">
				<NeoReveal>
					<NeoEyebrow>Get started</NeoEyebrow>
					<h2 id="install-title" className="np-display mt-4 text-otto-text">
						<span className="whitespace-nowrap">One command.</span>
					</h2>
					<p className="mt-5 max-w-[44ch] text-[15px] leading-relaxed text-otto-muted">
						Install a self-contained binary, choose your provider in the guided
						setup, and start your first task.
					</p>
				</NeoReveal>

				<NeoReveal delay={80}>
					<div className="mt-9 grid max-w-[720px] grid-cols-1 gap-4 sm:grid-cols-2">
						<CommandCard cmd={CURL_CMD} label="Recommended" method="curl" />
						<CommandCard cmd={BUN_CMD} label="With bun" method="bun" />
					</div>
				</NeoReveal>

				<div id="desktop" className="mt-16 scroll-mt-16 sm:mt-20">
					<NeoReveal>
						<div className="mb-6 flex flex-wrap items-end justify-between gap-4">
							<div>
								<NeoEyebrow>Desktop app</NeoEyebrow>
								<h3 className="np-title mt-3 text-otto-text">
									Prefer a window?
								</h3>
							</div>
							<p className="max-w-[34ch] text-[13px] leading-relaxed text-otto-muted">
								The same otto in a native app for macOS and Linux.
							</p>
						</div>
					</NeoReveal>

					<NeoReveal delay={80}>
						<DesktopDownloads />
					</NeoReveal>
				</div>

				<NeoReveal delay={120}>
					<div className="mt-14 flex flex-col gap-3 border-t-2 border-otto-border pt-8 sm:flex-row sm:flex-wrap sm:items-center">
						<NeoButton
							href="/docs"
							tone="ink"
							size="lg"
							data-s-event="Click docs CTA"
							data-s-event-props="source=install"
						>
							Read the docs
						</NeoButton>
						<NeoButton
							href="https://github.com/nitishxyz/otto"
							variant="outline"
							size="lg"
							data-s-event="Click GitHub CTA"
							data-s-event-props="source=install"
						>
							Star on GitHub
						</NeoButton>
						<p className="text-[12px] text-otto-dim sm:ml-auto">
							Open source · MIT licensed
						</p>
					</div>
				</NeoReveal>
			</div>
		</NeoSection>
	);
}
