import { useState, useEffect } from 'react';
import { OttoWordmark } from './OttoWordmark';
import { useTheme } from '../hooks/useTheme';

function OttoRouterIcon() {
	return (
		<svg
			aria-hidden="true"
			className="w-3.5 h-3.5"
			viewBox="0 0 100 100"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M55.0151 11H45.7732C42.9871 11 41.594 11 40.5458 11.7564C39.4977 12.5128 39.0587 13.8349 38.1807 16.479L28.4934 45.6545C26.899 50.4561 26.1019 52.8569 27.2993 54.5162C28.4967 56.1754 31.0264 56.1754 36.0858 56.1754H38.1307C41.9554 56.1754 43.8677 56.1754 45.0206 57.2527C45.2855 57.5002 45.5155 57.7825 45.7043 58.092C46.5262 59.4389 46.1395 61.3117 45.3662 65.0574C42.291 79.9519 40.7534 87.3991 43.0079 88.8933C43.4871 89.2109 44.0292 89.4215 44.5971 89.5107C47.2691 89.9303 51.1621 83.398 58.9481 70.3336L70.7118 50.5949C72.8831 46.9517 73.9687 45.13 73.6853 43.639C73.5201 42.7697 73.0712 41.9797 72.4091 41.3927C71.2734 40.386 69.1528 40.386 64.9115 40.386C61.2258 40.386 59.3829 40.386 58.2863 39.5068C57.6438 38.9916 57.176 38.2907 56.9467 37.4998C56.5553 36.1498 57.2621 34.4479 58.6757 31.044L62.4033 22.0683C64.4825 17.0618 65.5221 14.5585 64.3345 12.7793C63.1468 11 60.4362 11 55.0151 11Z" />
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
	const { theme, toggle } = useTheme();

	const handleSectionLink = (hash: string) => (e: React.MouseEvent) => {
		e.preventDefault();
		if (pathname !== '/') {
			window.location.href = `/#${hash}`;
		} else {
			document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
		}
	};

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 20);
		window.addEventListener('scroll', onScroll);
		return () => window.removeEventListener('scroll', onScroll);
	}, []);

	return (
		<nav
			className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
				scrolled
					? 'bg-otto-bg/90 backdrop-blur-md border-b border-otto-border'
					: isDocs
						? 'bg-otto-bg border-b border-otto-border'
						: 'bg-transparent'
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
							onClick={handleSectionLink('install')}
							className="px-3.5 py-1.5 border border-otto-border text-otto-muted text-xs rounded-sm hover:border-otto-border-light hover:text-otto-text transition-colors"
							data-s-event="Click install CTA"
							data-s-event-props="source=nav"
						>
							Install
						</button>
						<button
							type="button"
							onClick={handleSectionLink('desktop')}
							className="px-3.5 py-1.5 bg-otto-text text-otto-bg text-xs font-medium rounded-sm hover:opacity-80 transition-colors flex items-center gap-1.5"
							data-s-event="Click desktop CTA"
							data-s-event-props="source=nav"
						>
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
							Desktop
						</button>
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
				<div className="md:hidden bg-otto-bg/95 backdrop-blur-md border-b border-otto-border px-6 py-4 space-y-3 text-sm">
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
						onClick={handleSectionLink('install')}
						className="block text-otto-muted hover:text-otto-text"
						data-s-event="Click install CTA"
						data-s-event-props="source=mobile-nav"
					>
						Install
					</button>
					<button
						type="button"
						onClick={handleSectionLink('desktop')}
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
