interface IconProps {
	className?: string;
}

function Svg({
	className = 'w-4 h-4',
	children,
}: IconProps & { children: React.ReactNode }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			{children}
		</svg>
	);
}

export function DownloadIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" x2="12" y1="15" y2="3" />
		</Svg>
	);
}

export function TerminalIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<polyline points="4 17 10 11 4 5" />
			<line x1="12" y1="19" x2="20" y2="19" />
		</Svg>
	);
}

export function BrowserIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<rect x="2" y="4" width="20" height="16" rx="2" />
			<path d="M2 9h20" />
			<circle cx="5.5" cy="6.5" r="0.5" fill="currentColor" />
		</Svg>
	);
}

export function ShareIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<path d="M15 3h6v6" />
			<path d="M10 14 21 3" />
			<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
		</Svg>
	);
}

export function LayoutIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<path d="M3 9h18" />
			<path d="M10 9v12" />
		</Svg>
	);
}

export function SparkIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
		</Svg>
	);
}

export function CheckIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<path d="M20 6 9 17l-5-5" />
		</Svg>
	);
}

export function SearchIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
		</Svg>
	);
}

export function FileEditIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4" />
			<path d="M14 2v4a2 2 0 0 0 2 2h4" />
			<path d="M3 15h6" />
			<path d="M6 12v6" />
		</Svg>
	);
}

export function GitBranchIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<line x1="6" y1="3" x2="6" y2="15" />
			<circle cx="18" cy="6" r="3" />
			<circle cx="6" cy="18" r="3" />
			<path d="M18 9a9 9 0 0 1-9 9" />
		</Svg>
	);
}

export function PlugIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<path d="M12 22v-5" />
			<path d="M9 8V2" />
			<path d="M15 8V2" />
			<path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
		</Svg>
	);
}

export function ArrowIcon(p: IconProps) {
	return (
		<Svg {...p}>
			<path d="M5 12h14" />
			<path d="m12 5 7 7-7 7" />
		</Svg>
	);
}

export function AppleIcon({ className = 'w-5 h-5' }: IconProps) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 24 24"
			fill="currentColor"
		>
			<path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
		</svg>
	);
}

export function LinuxIcon({ className = 'w-5 h-5' }: IconProps) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 24 24"
			fill="currentColor"
		>
			<path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 0 0-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.368 1.884 1.368.39 0 .739-.134 1.107-.534.117.109.272.186.398.186.553 0 1.109-1.107 1.171-2.174.066-1.146-.142-2.074-.142-2.074s.476-.528.945-1.251c.453-.697.838-1.544.838-2.449 0-.543-.16-.723-.16-1.063 0-.34.199-.795.199-1.458 0-1.076-.535-1.746-1.292-2.478-.8-.8-1.851-1.293-2.334-2.259-.37-.72-.533-1.905-.672-3.019C16.031 1.995 15.068 0 12.504 0z" />
		</svg>
	);
}
