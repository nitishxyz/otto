import type { ReactNode } from 'react';
import { useInView } from '../../hooks/useInView';
import { cn } from './cn';

export interface NeoSectionProps {
	id?: string;
	children: ReactNode;
	/** Draw the full-bleed 2px rule above the section. */
	rule?: boolean;
	/** Inner container width. */
	width?: 'narrow' | 'default' | 'wide';
	className?: string;
	innerClassName?: string;
	'aria-labelledby'?: string;
}

const WIDTH = {
	narrow: 'max-w-[760px]',
	default: 'max-w-[1080px]',
	wide: 'max-w-[1280px]',
} as const;

/**
 * Editorial section shell: full-bleed top rule, consistent gutters
 * (20px / 32px / 48px) and a centred measure.
 */
export function NeoSection({
	id,
	children,
	rule = true,
	width = 'default',
	className,
	innerClassName,
	...rest
}: NeoSectionProps) {
	return (
		<section
			id={id}
			className={cn(
				'relative w-full scroll-mt-16',
				rule && 'np-edge-t',
				className,
			)}
			{...rest}
		>
			<div
				className={cn(
					'mx-auto w-full px-5 sm:px-8 lg:px-12',
					WIDTH[width],
					innerClassName,
				)}
			>
				{children}
			</div>
		</section>
	);
}

export interface NeoRevealProps {
	children: ReactNode;
	/** Stagger delay in milliseconds. */
	delay?: number;
	className?: string;
}

/**
 * Scroll reveal that fully opts out under `prefers-reduced-motion`
 * (handled in CSS by the `.np-reveal` rules).
 */
export function NeoReveal({ children, delay = 0, className }: NeoRevealProps) {
	const { ref, visible } = useInView();
	return (
		<div
			ref={ref}
			className={cn('np-reveal', visible && 'is-visible', className)}
			style={delay ? { transitionDelay: `${delay}ms` } : undefined}
		>
			{children}
		</div>
	);
}

export interface NeoEyebrowProps {
	children: ReactNode;
	className?: string;
}

/** Mono uppercase micro-label that opens each section. */
export function NeoEyebrow({ children, className }: NeoEyebrowProps) {
	return (
		<p className={cn('np-eyebrow text-otto-dim', className)}>{children}</p>
	);
}
