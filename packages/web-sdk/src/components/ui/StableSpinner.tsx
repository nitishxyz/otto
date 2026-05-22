import type { SVGProps } from 'react';

const SIZE_CLASS_NAMES = {
	xs: 'h-3 w-3',
	sm: 'h-3.5 w-3.5',
	md: 'h-4 w-4',
	lg: 'h-5 w-5',
	xl: 'h-8 w-8',
} as const;

interface StableSpinnerProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
	size?: keyof typeof SIZE_CLASS_NAMES;
	title?: string;
}

export function StableSpinner({
	size = 'md',
	title = 'Loading',
	className = '',
	...props
}: StableSpinnerProps) {
	return (
		<svg
			className={`block ${SIZE_CLASS_NAMES[size]} ${className}`.trim()}
			viewBox="0 0 16 16"
			fill="none"
			role="img"
			aria-label={title}
			{...props}
		>
			<title>{title}</title>
			<g
				className="origin-center animate-spin"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.8"
				style={{ transformBox: 'view-box', transformOrigin: '8px 8px' }}
			>
				<path d="M8 1.75v2" />
				<path d="M12.42 3.58 11 5" />
				<path d="M14.25 8h-2" />
				<path d="M12.42 12.42 11 11" />
				<path d="M8 14.25v-2" />
				<path d="M3.58 12.42 5 11" />
				<path d="M1.75 8h2" />
				<path d="M3.58 3.58 5 5" />
			</g>
		</svg>
	);
}
