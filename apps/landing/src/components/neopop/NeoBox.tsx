import type { HTMLAttributes } from 'react';
import { cn } from './cn';
import {
	ACCENT_TINT,
	ELEVATION,
	NEO_RADIUS,
	TONE_EDGE,
	TONE_SURFACE,
	type NeoAccent,
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
	/**
	 * Draws the edge and hard shadow in a brand colour while the fill stays
	 * neutral. Ignored when `tone` is itself an accent, since that surface
	 * already carries the colour and takes its deep shade instead.
	 */
	accent?: NeoAccent;
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
	accent,
	elevation = 'none',
	bordered = true,
	interactive = false,
	className,
	children,
	...rest
}: NeoBoxProps) {
	const toneEdge = TONE_EDGE[tone];
	return (
		<Tag
			className={cn(
				NEO_RADIUS,
				TONE_SURFACE[tone],
				toneEdge || (accent && ACCENT_TINT[accent]),
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
