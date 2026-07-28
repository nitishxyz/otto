import { useState, useEffect } from 'react';
import { OttoWordmark } from './OttoWordmark';
import { useTheme } from '../hooks/useTheme';
import { sectionLink } from '../lib/section-link';
import { NeoButton } from './neopop';

function OttoRouterIcon() {
	return (
		<svg
			aria-hidden="true"
			className="w-3.5 h-3.5"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			<circle cx="12" cy="12" r="8" />
			<path d="M12 2v7.5" />
			<path d="m19 5-5.23 5.23" />
			<path d="M22 12h-7.5" />
			<path d="m19 19-5.23-5.23" />
			<path d="M12 14.5V22" />
			<path d="M10.23 13.77 5 19" />
			<path d="M9.5 12H2" />
			<path d="M10.23 10.23 5 5" />
			<circle cx="12" cy="12" r="2.5" />
		</svg>
	);
}

function DesktopIcon() {
	return (
		<svg
			aria-hidden="true"
			className="w-3.5 h-3.5"
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
	);
}

function SunIcon() {
	return (
		<svg
			aria-hidden="true"
			className="w-4 h-4"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="12" cy="12" r="5" />
			<line x1="12" y1="1" x2="12" y2="3" />
			<line x1="12" y1="21" x2="12" y2="23" />
			<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
			<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
			<line x1="1" y1="12" x2="3" y2="12" />
			<line x1="21" y1="12" x2="23" y2="12" />
			<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
			<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
		</svg>
	);
}

function MoonIcon() {
	return (
		<svg
			aria-hidden="true"
			className="w-4 h-4"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
		</svg>
	);
}

export function Nav({ pathname }: { pathname: string }) {
	const [scrolled, setScrolled] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const isDocs = pathname.startsWith('/docs');
	// NeoPop chrome covers the homepage and /docs/**; /ottorouter keeps the
	// original nav appearance.
	const isNeo = pathname === '/' || isDocs;
	const { theme, toggle } = useTheme();

	// The mobile panel overlays the page, so it has to close before a smooth
	// scroll starts or it sits on top of the destination.
	const closeThen =
		(handler: (event: React.MouseEvent<HTMLElement>) => void) =>
		(event: React.MouseEvent<HTMLElement>) => {
			setMobileOpen(false);
			handler(event);
		};

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 20);
		window.addEventListener('scroll', onScroll);
		return () => window.removeEventListener('scroll', onScroll);
	}, []);

	// Docs keep the hard edge at all times because content scrolls beneath the
	// sidebar; the homepage only draws it once the hero has scrolled away.
	const neoShell =
		scrolled || isDocs
			? 'bg-otto-bg np-edge-b'
			: 'bg-transparent border-b-2 border-transparent';

	const defaultShell = scrolled
		? 'bg-otto-bg/90 backdrop-blur-md border-b border-otto-border'
		: 'bg-transparent';

	return (
		<nav
			className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-300 ${
				isNeo ? neoShell : defaultShell
			}`}
		>
			<div className="h-14 flex items-center">
				<div className="w-64 shrink-0 hidden lg:flex items-center px-4">
					<a href="/" className="flex items-center gap-2 group">
						<OttoWordmark height={18} className="text-otto-text" />
					</a>
				</div>
				<div className="flex-1 flex items-center justify-between px-6 lg:px-8">
					<a href="/" className="flex items-center gap-2 group lg:hidden">
						<OttoWordmark height={18} className="text-otto-text" />
					</a>

					<div className="hidden md:flex items-center gap-5 text-[13px] ml-auto">
						<a
							href="/docs"
							className="text-otto-muted hover:text-otto-text transition-colors"
							data-s-event="Click docs CTA"
							data-s-event-props="source=nav"
						>
							Docs
						</a>
						<a
							href="https://github.com/nitishxyz/otto"
							target="_blank"
							rel="noopener noreferrer"
							className="text-otto-muted hover:text-otto-text transition-colors"
							data-s-event="Click GitHub CTA"
							data-s-event-props="source=nav"
						>
							GitHub
						</a>
						<button
							type="button"
							onClick={toggle}
							className="p-1.5 rounded-sm text-otto-muted hover:text-otto-text hover:bg-otto-card transition-colors"
							title={
								theme === 'dark'
									? 'Switch to light mode'
									: 'Switch to dark mode'
							}
						>
							{theme === 'dark' ? <SunIcon /> : <MoonIcon />}
						</button>
						{isNeo ? (
							<>
								<NeoButton
									href="https://ottorouter.org"
									target="_self"
									rel=""
									tone="blue"
									size="sm"
									data-s-event="Click OttoRouter CTA"
									data-s-event-props="source=nav"
								>
									<OttoRouterIcon />
									OttoRouter
								</NeoButton>
								<NeoButton
									variant="outline"
									size="sm"
									onClick={sectionLink('install')}
									data-s-event="Click install CTA"
									data-s-event-props="source=nav"
								>
									Install
								</NeoButton>
								<NeoButton
									tone="ink"
									size="sm"
									onClick={sectionLink('desktop')}
									data-s-event="Click desktop CTA"
									data-s-event-props="source=nav"
								>
									<DesktopIcon />
									Desktop
								</NeoButton>
							</>
						) : (
							<>
								<a
									href="https://ottorouter.org"
									className="px-3.5 py-1.5 border border-blue-400/50 text-blue-400 text-xs font-medium rounded-sm hover:border-blue-400 transition-colors inline-flex items-center gap-1.5"
									data-s-event="Click OttoRouter CTA"
									data-s-event-props="source=nav"
								>
									<OttoRouterIcon />
									OttoRouter
								</a>
								<button
									type="button"
									onClick={sectionLink('install')}
									className="px-3.5 py-1.5 border border-otto-border text-otto-muted text-xs rounded-sm hover:border-otto-border-light hover:text-otto-text transition-colors"
									data-s-event="Click install CTA"
									data-s-event-props="source=nav"
								>
									Install
								</button>
								<button
									type="button"
									onClick={sectionLink('desktop')}
									className="px-3.5 py-1.5 bg-otto-text text-otto-bg text-xs font-medium rounded-sm hover:opacity-80 transition-colors flex items-center gap-1.5"
									data-s-event="Click desktop CTA"
									data-s-event-props="source=nav"
								>
									<DesktopIcon />
									Desktop
								</button>
							</>
						)}
					</div>

					<div className="flex items-center gap-3 md:hidden">
						<button
							type="button"
							onClick={toggle}
							className="p-1.5 rounded-sm text-otto-muted hover:text-otto-text transition-colors"
							title={
								theme === 'dark'
									? 'Switch to light mode'
									: 'Switch to dark mode'
							}
						>
							{theme === 'dark' ? <SunIcon /> : <MoonIcon />}
						</button>
						<button
							type="button"
							onClick={() => setMobileOpen(!mobileOpen)}
							aria-expanded={mobileOpen}
							aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
							className="text-otto-muted hover:text-otto-text"
						>
							<svg
								aria-hidden="true"
								width="20"
								height="20"
								viewBox="0 0 20 20"
								fill="none"
							>
								{mobileOpen ? (
									<path
										d="M5 5L15 15M15 5L5 15"
										stroke="currentColor"
										strokeWidth="1.5"
									/>
								) : (
									<path
										d="M3 6H17M3 10H17M3 14H17"
										stroke="currentColor"
										strokeWidth="1.5"
									/>
								)}
							</svg>
						</button>
					</div>
				</div>
			</div>

			{mobileOpen && (
				<div
					className={`md:hidden px-6 py-4 space-y-3 text-sm ${
						isNeo
							? 'bg-otto-bg np-edge-b'
							: 'bg-otto-bg/95 backdrop-blur-md border-b border-otto-border'
					}`}
				>
					<a
						href="https://ottorouter.org"
						className="flex items-center gap-1.5 text-otto-muted hover:text-otto-text"
						data-s-event="Click OttoRouter CTA"
						data-s-event-props="source=mobile-nav"
					>
						<span className="text-otto-muted">
							<OttoRouterIcon />
						</span>
						OttoRouter
					</a>
					<a
						href="/docs"
						className="block text-otto-muted hover:text-otto-text"
						data-s-event="Click docs CTA"
						data-s-event-props="source=mobile-nav"
					>
						Docs
					</a>
					<a
						href="https://github.com/nitishxyz/otto"
						target="_blank"
						rel="noopener noreferrer"
						className="block text-otto-muted hover:text-otto-text"
						data-s-event="Click GitHub CTA"
						data-s-event-props="source=mobile-nav"
					>
						GitHub
					</a>
					<button
						type="button"
						onClick={closeThen(sectionLink('install'))}
						className="block text-otto-muted hover:text-otto-text"
						data-s-event="Click install CTA"
						data-s-event-props="source=mobile-nav"
					>
						Install
					</button>
					<button
						type="button"
						onClick={closeThen(sectionLink('desktop'))}
						className="block text-otto-muted hover:text-otto-text"
						data-s-event="Click desktop CTA"
						data-s-event-props="source=mobile-nav"
					>
						Desktop App
					</button>
				</div>
			)}
		</nav>
	);
}
