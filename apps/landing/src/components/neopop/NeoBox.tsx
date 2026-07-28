import type { HTMLAttributes } from 'react';
import { cn } from './cn';
import {
	ELEVATION,
	NEO_RADIUS,
	TONE_SURFACE,
	type NeoElevation,
	type NeoTone,
} from './tokens';

type BoxElement =
	| 'div'
	| 'section'
	| 'article'
	| 'aside'
	| 'header'
	| 'footer'
	| 'li'
	| 'figure';

export interface NeoBoxProps extends HTMLAttributes<HTMLElement> {
	/** Semantic element to render. Defaults to `div`. */
	as?: BoxElement;
	/** Background/foreground pair. */
	tone?: NeoTone;
	/** Hard offset shadow depth. */
	elevation?: NeoElevation;
	/** 2px hard border. Disable for cells inside a hairline grid. */
	bordered?: boolean;
	/** Animate a small lift on hover. Ignored under `prefers-reduced-motion`. */
	interactive?: boolean;
}

/**
 * Boxy NeoPop container: near-square corners, 2px border, hard offset shadow.
 * `className` is appended last so callers can extend padding, layout, or colour.
 */
export function NeoBox({
	as: Tag = 'div',
	tone = 'surface',
	elevation = 'none',
	bordered = true,
	interactive = false,
	className,
	children,
	...rest
}: NeoBoxProps) {
	return (
		<Tag
			className={cn(
				NEO_RADIUS,
				TONE_SURFACE[tone],
				bordered && 'np-edge',
				ELEVATION[elevation],
				interactive && elevation !== 'none' && 'np-lift',
				className,
			)}
			{...rest}
		>
			{children}
		</Tag>
	);
}
