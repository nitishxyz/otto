import type { CSSProperties, SVGProps } from 'react';

const SIZE_CLASS_NAMES = {
	xs: 'h-3 w-3',
	sm: 'h-3.5 w-3.5',
	md: 'h-4 w-4',
	lg: 'h-5 w-5',
	xl: 'h-8 w-8',
} as const;

/**
 * WebKit cannot run an accelerated transform animation on an element inside
 * `<svg>`, so spinning an inner `<g>` forces a main-thread style resolution,
 * layout and full compositing update on every display frame for as long as the
 * spinner is mounted. Spinning the `<svg>` box itself keeps the animation on
 * the compositor; `will-change` pins the layer and `contain` stops the
 * per-frame invalidation from escaping into the surrounding tree.
 */
const ACCELERATED_SPIN_STYLE: CSSProperties = {
	willChange: 'transform',
	contain: 'layout style',
};

interface StableSpinnerProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
	size?: keyof typeof SIZE_CLASS_NAMES;
	title?: string;
}

export function StableSpinner({
	size = 'md',
	title = 'Loading',
	className = '',
	style,
	...props
}: StableSpinnerProps) {
	return (
		<svg
			className={`block animate-spin ${SIZE_CLASS_NAMES[size]} ${className}`.trim()}
			viewBox="0 0 16 16"
			fill="none"
			role="img"
			aria-label={title}
			style={{ ...ACCELERATED_SPIN_STYLE, ...style }}
			{...props}
		>
			<title>{title}</title>
			<g stroke="currentColor" strokeLinecap="round" strokeWidth="1.8">
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
