import { useCallback, useState } from 'react';
import type { MouseEventHandler, ReactNode } from 'react';
import { cn } from './cn';
import {
	NEO_RADIUS,
	TONE_EDGE,
	TONE_EDGE_HOVER,
	TONE_SURFACE,
	type NeoTone,
} from './tokens';

export type NeoButtonVariant = 'solid' | 'outline' | 'ghost';
export type NeoButtonSize = 'sm' | 'md' | 'lg';

const SIZE: Record<NeoButtonSize, string> = {
	sm: 'h-8 px-3 text-[12px] gap-1.5',
	md: 'h-11 px-5 text-[13px] gap-2',
	lg: 'h-[52px] px-6 text-[15px] gap-2.5',
};

const SHADOW: Record<NeoButtonSize, string> = {
	sm: 'np-shadow-sm',
	md: 'np-shadow-md',
	lg: 'np-shadow-md',
};

export interface NeoButtonProps {
	children: ReactNode;
	/** Render as an anchor when set, otherwise a `button`. */
	href?: string;
	target?: string;
	rel?: string;
	type?: 'button' | 'submit';
	onClick?: MouseEventHandler<HTMLElement>;
	tone?: NeoTone;
	variant?: NeoButtonVariant;
	size?: NeoButtonSize;
	/** Stretch to the width of the parent. */
	block?: boolean;
	disabled?: boolean;
	className?: string;
	'aria-label'?: string;
	/** Analytics hooks consumed by the OneDollarStats script. */
	'data-s-event'?: string;
	'data-s-event-props'?: string;
}

/**
 * NeoPop action. Solid and outline variants carry a hard offset shadow and
 * translate into it on press; ghost stays flat for tertiary actions.
 */
export function NeoButton({
	children,
	href,
	target,
	rel,
	type = 'button',
	onClick,
	tone = 'ink',
	variant = 'solid',
	size = 'md',
	block = false,
	disabled = false,
	className,
	...rest
}: NeoButtonProps) {
	// Touch input never resolves `:active` reliably, so pointer events drive an
	// explicit pressed class instead.
	const [pressed, setPressed] = useState(false);
	const press = useCallback(() => setPressed(true), []);
	const release = useCallback(() => setPressed(false), []);

	const base = cn(
		'inline-flex items-center justify-center font-medium tracking-tight',
		'no-underline select-none',
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
		'focus-visible:ring-np-blue focus-visible:ring-offset-otto-bg',
		NEO_RADIUS,
		SIZE[size],
		block && 'w-full',
		disabled && 'pointer-events-none opacity-50',
	);

	const skin =
		variant === 'solid'
			? cn(
					'np-edge',
					TONE_SURFACE[tone],
					// Accent fills carry an edge and drop in their own deep shade.
					TONE_EDGE[tone],
					TONE_EDGE_HOVER[tone],
					SHADOW[size],
					'np-press',
					pressed && 'is-pressed',
				)
			: variant === 'outline'
				? cn(
						// Opaque so the hard shadow never reads through the surface.
						'np-edge bg-otto-bg text-otto-text',
						// The fill matches the page, so the edge takes the text colour
						// on hover instead of disappearing.
						'[--np-edge-hover:var(--otto-text)]',
						SHADOW[size],
						'np-press',
						pressed && 'is-pressed',
					)
				: cn(
						'border-2 border-transparent text-otto-muted',
						'hover:text-otto-text hover:border-otto-border transition-colors duration-150',
					);

	const classes = cn(base, skin, className);
	const pressHandlers =
		variant === 'solid' || variant === 'outline'
			? {
					onPointerDown: press,
					onPointerUp: release,
					onPointerLeave: release,
					onPointerCancel: release,
				}
			: undefined;

	if (href) {
		// External links open in a new tab by default; pass `target`/`rel`
		// explicitly (an empty `rel` clears it) to keep same-tab navigation.
		const external = href.startsWith('http');
		const resolvedTarget = target ?? (external ? '_blank' : undefined);
		const resolvedRel =
			rel === ''
				? undefined
				: (rel ??
					(resolvedTarget === '_blank' ? 'noopener noreferrer' : undefined));
		return (
			<a
				href={href}
				target={resolvedTarget}
				rel={resolvedRel}
				className={classes}
				onClick={onClick}
				{...pressHandlers}
				{...rest}
			>
				{children}
			</a>
		);
	}

	return (
		<button
			type={type === 'submit' ? 'submit' : 'button'}
			onClick={onClick}
			disabled={disabled}
			className={classes}
			{...pressHandlers}
			{...rest}
		>
			{children}
		</button>
	);
}
