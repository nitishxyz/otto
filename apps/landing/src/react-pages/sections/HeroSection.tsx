import { useEffect, useState } from 'react';
import { OttoWordmark } from '../../components/OttoWordmark';
import { ProviderLogo } from '../../components/ProviderLogo';
import { Reveal } from '../../components/Reveal';

function ProductMockup() {
	const [step, setStep] = useState(0);
	const maxSteps = 7;

	useEffect(() => {
		const t = setInterval(
			() => setStep((s) => (s < maxSteps ? s + 1 : s)),
			600,
		);
		return () => clearInterval(t);
	}, []);

	return (
		<div className="bg-otto-surface border border-otto-border rounded-lg overflow-hidden shadow-2xl shadow-black/10 dark:shadow-black/50">
			<div className="h-14 border-b border-otto-border bg-otto-surface/95 flex items-center justify-between px-6">
				<div className="flex items-center gap-2 text-sm text-otto-muted min-w-0 flex-1 mr-4">
					<svg
						className="w-4 h-4 flex-shrink-0"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
					</svg>
					<span className="text-otto-text font-medium truncate">
						Build waitlist page
					</span>
				</div>
				<div className="flex-shrink-0 flex items-center gap-3 sm:gap-5 text-xs sm:text-sm text-otto-muted">
					<div className="hidden sm:flex items-center gap-1">
						<span className="text-xs opacity-70">ctx</span>
						<span className="font-medium text-otto-text">8.2K</span>
					</div>
					<div className="flex items-center gap-1.5">
						<svg
							className="w-4 h-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<line x1="12" x2="12" y1="2" y2="22" />
							<path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
						</svg>
						<span className="font-medium text-otto-text">0.0041</span>
					</div>
					<div className="hidden sm:flex items-center gap-2">
						<ProviderLogo
							provider="anthropic"
							size={16}
							className="text-[#cc785c]"
						/>
						<span className="font-medium text-otto-text truncate max-w-40">
							claude-sonnet-4
						</span>
					</div>
				</div>
			</div>

			<div className="px-6 py-5 space-y-8 min-h-[340px] sm:min-h-[380px]">
				{step >= 1 && (
					<div className="flex justify-end animate-fade-in">
						<div className="flex flex-col items-end min-w-0 max-w-md">
							<div className="flex items-center gap-2 text-xs text-otto-muted pb-2 justify-end">
								<span className="font-medium text-emerald-600 dark:text-emerald-300">
									You
								</span>
								<span>·</span>
								<span>12:34</span>
							</div>
							<div className="inline-block text-sm text-otto-text leading-relaxed bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/30 dark:border-emerald-500/20 rounded-xl px-4 py-3">
								build me a waitlist page with a gradient bg and confetti on
								signup
							</div>
						</div>
					</div>
				)}

				{step >= 2 && (
					<div className="animate-fade-in">
						<div className="pb-2">
							<div className="inline-flex items-center bg-violet-500/10 dark:bg-violet-500/5 border border-violet-500/30 dark:border-violet-500/20 rounded-full pr-3 md:pr-4">
								<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-500/40 dark:border-violet-500/50 bg-violet-500/15 dark:bg-violet-500/10">
									<svg
										className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
										<path d="M5 3v4" />
										<path d="M19 17v4" />
										<path d="M3 5h4" />
										<path d="M17 19h4" />
									</svg>
								</div>
								<div className="flex items-center gap-x-2 text-xs text-otto-muted pl-2 md:pl-3">
									<span className="font-medium text-violet-600 dark:text-violet-300">
										build
									</span>
									<span className="text-otto-dim/50">·</span>
									<span>claude-sonnet-4</span>
								</div>
							</div>
						</div>

						<div className="relative ml-1">
							{step >= 3 && (
								<div className="flex gap-3 pb-2 relative animate-fade-in">
									<div className="flex-shrink-0 w-6 flex items-start justify-center relative pt-0.5">
										<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative bg-otto-surface">
											<svg
												className="h-4 w-4 text-amber-600 dark:text-amber-300"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
											>
												<circle cx="11" cy="11" r="8" />
												<path d="m21 21-4.3-4.3" />
											</svg>
										</div>
										<div
											className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-otto-border"
											style={{ top: '1.25rem', bottom: '-0.5rem' }}
										/>
									</div>
									<div className="flex-1 min-w-0 pt-1">
										<div className="flex items-center gap-2 text-xs whitespace-nowrap overflow-hidden">
											<span className="text-amber-600 dark:text-amber-300 font-medium">
												glob
											</span>
											<span className="text-otto-dim truncate">
												src/**/*.tsx — 8 files
											</span>
										</div>
									</div>
								</div>
							)}

							{step >= 4 && (
								<div className="flex gap-3 pb-2 relative animate-fade-in">
									<div className="flex-shrink-0 w-6 flex items-start justify-center relative pt-0.5">
										<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative bg-otto-surface">
											<svg
												className="h-4 w-4 text-emerald-600 dark:text-emerald-300"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
											>
												<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4" />
												<path d="M14 2v4a2 2 0 0 0 2 2h4" />
												<path d="M3 15h6" />
												<path d="M6 12v6" />
											</svg>
										</div>
										<div
											className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-otto-border"
											style={{ top: '1.25rem', bottom: '-0.5rem' }}
										/>
									</div>
									<div className="flex-1 min-w-0 pt-1">
										<div className="flex items-center gap-2 text-xs whitespace-nowrap overflow-hidden">
											<span className="text-emerald-600 dark:text-emerald-300 font-medium">
												write
											</span>
											<span className="text-otto-dim truncate">
												src/pages/Waitlist.tsx — 64 lines
											</span>
										</div>
									</div>
								</div>
							)}

							{step >= 5 && (
								<div className="flex gap-3 pb-2 relative animate-fade-in">
									<div className="flex-shrink-0 w-6 flex items-start justify-center relative pt-0.5">
										<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative bg-otto-surface">
											<svg
												className="h-4 w-4 text-purple-600 dark:text-purple-300"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
											>
												<path d="M12 3v14" />
												<path d="M5 10h14" />
												<path d="M5 21h14" />
											</svg>
										</div>
										<div
											className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-otto-border"
											style={{ top: '1.25rem', bottom: '-0.5rem' }}
										/>
									</div>
									<div className="flex-1 min-w-0 pt-1">
										<div className="flex items-center gap-2 text-xs whitespace-nowrap overflow-hidden">
											<span className="text-purple-600 dark:text-purple-300 font-medium">
												apply_patch
											</span>
											<span className="text-otto-dim truncate">
												App.tsx — 4 lines changed
											</span>
										</div>
									</div>
								</div>
							)}

							{step >= 6 && (
								<div className="flex gap-3 pb-2 relative animate-fade-in">
									<div className="flex-shrink-0 w-6 flex items-start justify-center relative pt-0.5">
										<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative bg-otto-surface">
											<svg
												className="h-4 w-4 text-otto-muted"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
											>
												<polyline points="4 17 10 11 4 5" />
												<line x1="12" y1="19" x2="20" y2="19" />
											</svg>
										</div>
										<div
											className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-otto-border"
											style={{ top: '1.25rem', bottom: '-0.5rem' }}
										/>
									</div>
									<div className="flex-1 min-w-0 pt-1">
										<div className="flex items-center gap-2 text-xs whitespace-nowrap overflow-hidden">
											<span className="text-otto-muted font-medium">
												terminal
											</span>
											<span className="text-otto-dim truncate">
												bun dev — ready on :3000
											</span>
										</div>
									</div>
								</div>
							)}

							{step >= 7 && (
								<div className="flex gap-3 relative animate-fade-in">
									<div className="flex-shrink-0 w-6 flex items-start justify-center relative pt-0.5">
										<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative bg-otto-surface">
											<svg
												className="h-4 w-4 text-emerald-600 dark:text-emerald-300"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
											>
												<path d="M20 6 9 17l-5-5" />
											</svg>
										</div>
									</div>
									<div className="flex-1 min-w-0 pt-0 -mt-0.5">
										<div className="text-sm text-otto-text leading-relaxed markdown-content">
											Created{' '}
											<code className="text-xs bg-otto-card border border-otto-border rounded px-1.5 py-0.5 text-otto-text">
												Waitlist.tsx
											</code>{' '}
											with an animated mesh gradient background and email
											capture form. On submit,{' '}
											<code className="text-xs bg-otto-card border border-otto-border rounded px-1.5 py-0.5 text-otto-text">
												canvas-confetti
											</code>{' '}
											fires 150 particles with a wide spread. Route wired up at{' '}
											<code className="text-xs bg-otto-card border border-otto-border rounded px-1.5 py-0.5 text-otto-text">
												/waitlist
											</code>
											.
										</div>
									</div>
								</div>
							)}
						</div>
					</div>
				)}
			</div>

			<div className="px-4 pb-4 pt-2">
				<div className="relative flex flex-col rounded-3xl p-1 bg-otto-card border border-otto-border">
					<div className="flex items-end gap-1">
						<div className="flex-1 px-4 py-2.5 text-sm text-otto-dim leading-normal">
							Type a message...
						</div>
						<button
							type="button"
							className="flex items-center justify-center w-10 h-10 rounded-full bg-transparent text-otto-dim flex-shrink-0"
						>
							<svg
								className="w-4 h-4"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="m5 12 7-7 7 7" />
								<path d="M12 19V5" />
							</svg>
						</button>
					</div>
				</div>
				<div className="flex items-center justify-center mt-1 px-3">
					<div className="text-[10px] text-otto-dim flex items-center gap-1">
						<ProviderLogo
							provider="anthropic"
							size={12}
							className="text-[#cc785c] opacity-70"
						/>
						<span className="opacity-40">/</span>
						<span>claude-sonnet-4</span>
					</div>
				</div>
			</div>
		</div>
	);
}

export function HeroSection() {
	return (
		<section className="relative min-h-[100dvh] flex flex-col items-center justify-center px-6 pt-20 pb-16">
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.06),transparent)]" />

			<div className="relative z-10 w-full max-w-3xl mx-auto">
				<Reveal>
					<div className="text-center mb-10 sm:mb-12">
						<OttoWordmark height={40} className="text-otto-text mx-auto mb-8" />
						<p className="text-otto-muted text-sm sm:text-base max-w-md mx-auto mb-8">
							Open-source AI coding assistant.
						</p>
						<div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
							<a
								href="#desktop"
								className="px-5 py-2.5 bg-otto-text text-otto-bg text-sm font-medium rounded-sm hover:opacity-80 transition-colors flex items-center gap-2"
								data-s-event="Click desktop CTA"
								data-s-event-props="source=hero"
							>
								<svg
									className="w-4 h-4"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
									<polyline points="7 10 12 15 17 10" />
									<line x1="12" x2="12" y1="15" y2="3" />
								</svg>
								Desktop App
							</a>
							<a
								href="/docs"
								className="px-5 py-2.5 border border-otto-border text-otto-muted text-sm rounded-sm hover:border-otto-border-light hover:text-otto-text transition-colors"
								data-s-event="Click docs CTA"
								data-s-event-props="source=hero"
							>
								Docs
							</a>
						</div>
					</div>
				</Reveal>

				<Reveal delay={200}>
					<ProductMockup />
				</Reveal>
			</div>
		</section>
	);
}
