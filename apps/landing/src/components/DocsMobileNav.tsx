function ShipWheelIcon() {
	return (
		<svg
			aria-hidden="true"
			className="w-3 h-3 shrink-0"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
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

const NAV_ITEMS = [
	{ href: '/docs', label: 'Installation & Setup', end: true },
	{ href: '/docs/usage', label: 'Usage Guide' },
	{ href: '/docs/configuration', label: 'Configuration' },
	{ href: '/docs/agents-tools', label: 'Agents & Tools' },
	{ href: '/docs/mcp', label: 'MCP Servers' },
	{ href: '/docs/sharing', label: 'Session Sharing' },
	{ href: '/docs/acp', label: 'ACP Integration' },
	{ href: '/docs/architecture', label: 'System Architecture' },
	{ href: '/docs/embedding', label: 'Embedding Guide' },
	{ href: '/docs/api', label: 'API Reference' },
	{ href: '/docs/ai-sdk', label: 'Overview', end: true },
	{ href: '/docs/ai-sdk/configuration', label: 'Configuration' },
	{ href: '/docs/ai-sdk/caching', label: 'Caching' },
	{ href: '/docs/ottorouter', label: 'OttoRouter', end: true, mark: true },
	{ href: '/docs/ottorouter/payments', label: 'Payments' },
	{ href: '/docs/ottorouter/integration', label: 'Integration Guide' },
	{ href: '/docs/ottorouter/openclaw', label: 'OpenClaw Plugin' },
];

function isActive(pathname: string, href: string, end?: boolean): boolean {
	const clean = pathname.replace(/\/$/, '') || '/';
	const target = href.replace(/\/$/, '') || '/';
	if (end) return clean === target;
	return clean === target || clean.startsWith(`${target}/`);
}

export function DocsMobileNav({ pathname }: { pathname: string }) {
	return (
		<div className="lg:hidden mb-8 -mx-6 px-6 overflow-x-auto pb-3 border-b border-otto-border scrollbar-hide">
			<div className="flex gap-1 w-max">
				{NAV_ITEMS.map((item) => {
					const active = isActive(pathname, item.href, item.end);
					return (
						<a
							key={item.href}
							href={item.href}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm whitespace-nowrap transition-colors ${
								active
									? 'bg-otto-card text-otto-text border border-otto-border'
									: 'text-otto-muted hover:text-otto-text'
							}`}
						>
							{'mark' in item && item.mark && <ShipWheelIcon />}
							{item.label}
						</a>
					);
				})}
			</div>
		</div>
	);
}
