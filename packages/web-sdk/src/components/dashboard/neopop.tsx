import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

/**
 * NeoPop primitives mirrored from the OttoRouter dashboard
 * (`setu/apps/web/src/components/neopop`) but re-expressed with Tailwind
 * arbitrary values so they work inside the product's shadcn-style theme
 * without adding global stylesheet rules to every app shell.
 *
 * The palette lives on {@link NEO_SCOPE}: put that class on the root of any
 * NeoPop surface and every descendant inherits the `--np-*` custom properties.
 */

export type NeoTone = 'surface' | 'card' | 'bg' | 'ink';

/** The four brand colours. Blue is primary, lime positive, yellow caution,
 * coral danger — the same semantics the OttoRouter dashboard uses. */
export type NeoAccent = 'blue' | 'lime' | 'yellow' | 'coral';

export type NeoElevation = 'none' | 'sm' | 'md' | 'lg';

export function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(' ');
}

/** Near-square corners keep the boxy silhouette while avoiding hard pixels. */
export const NEO_RADIUS = 'rounded-[3px]';

/** 11px / 0.18em / 600 uppercase — the NeoPop micro-label. */
export const NEO_EYEBROW =
	'text-[11px] font-semibold uppercase leading-none tracking-[0.18em]';

/**
 * Declares the whole NeoPop palette as inherited custom properties. The four
 * accents hold the same value in both themes so the dashboard reads
 * identically light or dark; only the structural edge/shadow neutrals flip,
 * because a hard offset shadow has to invert to stay visible.
 */
export const NEO_SCOPE = [
	'[--np-blue:72_101_204]',
	'[--np-blue-on:250_252_255]',
	'[--np-blue-cast:40_60_140]',
	'[--np-lime:98_173_139]',
	'[--np-lime-on:13_31_23]',
	'[--np-lime-cast:52_104_82]',
	'[--np-yellow:233_162_27]',
	'[--np-yellow-on:35_27_12]',
	'[--np-yellow-cast:158_106_12]',
	'[--np-coral:201_64_58]',
	'[--np-coral-on:255_250_249]',
	'[--np-coral-cast:132_36_31]',
	'[--np-edge:49_60_63]',
	'[--np-shadow:24_33_38]',
	'dark:[--np-edge:92_92_102]',
	'dark:[--np-shadow:178_187_209]',
].join(' ');

export const NEO_EDGE = 'border-2 border-[rgb(var(--np-edge))]';

export const ELEVATION: Record<NeoElevation, string> = {
	none: '',
	sm: 'shadow-[3px_3px_0_0_rgb(var(--np-shadow))]',
	md: 'shadow-[5px_5px_0_0_rgb(var(--np-shadow))]',
	lg: 'shadow-[8px_8px_0_0_rgb(var(--np-shadow))]',
};

/** Background + foreground pair for each neutral tone. */
export const TONE_SURFACE: Record<NeoTone, string> = {
	surface: 'bg-card text-foreground',
	card: 'bg-muted/40 text-foreground',
	bg: 'bg-background text-foreground',
	ink: 'bg-foreground text-background',
};

/** Solid accent fill, for chart bars, meters, and active controls. */
export const ACCENT_FILL: Record<NeoAccent, string> = {
	blue: 'bg-[rgb(var(--np-blue))]',
	lime: 'bg-[rgb(var(--np-lime))]',
	yellow: 'bg-[rgb(var(--np-yellow))]',
	coral: 'bg-[rgb(var(--np-coral))]',
};

/** Readable foreground on top of the matching {@link ACCENT_FILL}. */
export const ACCENT_ON: Record<NeoAccent, string> = {
	blue: 'text-[rgb(var(--np-blue-on))]',
	lime: 'text-[rgb(var(--np-lime-on))]',
	yellow: 'text-[rgb(var(--np-yellow-on))]',
	coral: 'text-[rgb(var(--np-coral-on))]',
};

/** Foreground-only accent colour, for values and icons on neutral surfaces. */
export const ACCENT_TEXT: Record<NeoAccent, string> = {
	blue: 'text-[rgb(var(--np-blue))]',
	lime: 'text-[rgb(var(--np-lime))]',
	yellow: 'text-[rgb(var(--np-yellow))]',
	coral: 'text-[rgb(var(--np-coral))]',
};

/**
 * Deep shade of each accent. A filled accent surface takes this for its border
 * and hard drop, so the extrusion reads as the fill in shadow rather than ink.
 */
export const ACCENT_CAST_BORDER: Record<NeoAccent, string> = {
	blue: 'border-[rgb(var(--np-blue-cast))]',
	lime: 'border-[rgb(var(--np-lime-cast))]',
	yellow: 'border-[rgb(var(--np-yellow-cast))]',
	coral: 'border-[rgb(var(--np-coral-cast))]',
};

export const ACCENT_CAST_SHADOW: Record<NeoAccent, string> = {
	blue: 'shadow-[2px_2px_0_0_rgb(var(--np-blue-cast))]',
	lime: 'shadow-[2px_2px_0_0_rgb(var(--np-lime-cast))]',
	yellow: 'shadow-[2px_2px_0_0_rgb(var(--np-yellow-cast))]',
	coral: 'shadow-[2px_2px_0_0_rgb(var(--np-coral-cast))]',
};

/**
 * Colours the edge and hard shadow in the accent itself while the fill stays
 * neutral — an outlined-and-dropped card.
 */
export const ACCENT_TINT: Record<NeoAccent, string> = {
	blue: '[--np-edge:var(--np-blue)] [--np-shadow:var(--np-blue)]',
	lime: '[--np-edge:var(--np-lime)] [--np-shadow:var(--np-lime)]',
	yellow: '[--np-edge:var(--np-yellow)] [--np-shadow:var(--np-yellow)]',
	coral: '[--np-edge:var(--np-coral)] [--np-shadow:var(--np-coral)]',
};

export const ACCENT_ORDER: NeoAccent[] = ['blue', 'lime', 'yellow', 'coral'];

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export interface NeoPanelProps extends HTMLAttributes<HTMLElement> {
	as?: 'div' | 'section' | 'article' | 'header' | 'aside' | 'li';
	tone?: NeoTone;
	/** Draws the edge and drop in a brand colour while the fill stays neutral. */
	accent?: NeoAccent;
	elevation?: NeoElevation;
	children?: ReactNode;
}

/**
 * Bordered dashboard surface. Elevation is opt-in: only hero-level panels and
 * stat tiles carry the hard drop, so a page of panels does not read as noise.
 */
export function NeoPanel({
	as: Tag = 'div',
	tone = 'surface',
	accent,
	elevation = 'none',
	className,
	children,
	...rest
}: NeoPanelProps) {
	return (
		<Tag
			className={cn(
				NEO_RADIUS,
				TONE_SURFACE[tone],
				accent && ACCENT_TINT[accent],
				NEO_EDGE,
				ELEVATION[elevation],
				className,
			)}
			{...rest}
		>
			{children}
		</Tag>
	);
}

/** Mono uppercase micro-label that opens each panel and stat. */
export function NeoEyebrow({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<span className={cn('block text-muted-foreground', NEO_EYEBROW, className)}>
			{children}
		</span>
	);
}

export interface NeoBadgeProps {
	children: ReactNode;
	accent?: NeoAccent;
	/** Outline-only rendering for lower-emphasis metadata. */
	outline?: boolean;
	title?: string;
	className?: string;
}

/** Compact boxy label used for status chips and deltas. */
export function NeoBadge({
	children,
	accent = 'lime',
	outline = false,
	title,
	className,
}: NeoBadgeProps) {
	return (
		<span
			title={title}
			className={cn(
				'inline-flex items-center gap-1 whitespace-nowrap border-2 px-1.5 py-0.5',
				'text-[10px] font-semibold uppercase leading-none tracking-[0.12em]',
				NEO_RADIUS,
				outline
					? cn(
							'bg-transparent',
							ACCENT_TEXT[accent],
							ACCENT_CAST_BORDER[accent],
						)
					: cn(
							ACCENT_FILL[accent],
							ACCENT_ON[accent],
							ACCENT_CAST_BORDER[accent],
						),
				className,
			)}
		>
			{children}
		</span>
	);
}

export interface NeoTabOption<T extends string> {
	value: T;
	label: ReactNode;
	title?: string;
}

export interface NeoTabsProps<T extends string> {
	options: ReadonlyArray<NeoTabOption<T>>;
	value: T;
	onChange: (value: T) => void;
	/** Fill colour of the active cell. */
	accent?: NeoAccent;
	'aria-label': string;
	className?: string;
}

/**
 * Segmented control: a bordered tray of flat cells where the selected cell
 * lifts out as a filled accent block with its own cast shadow.
 */
export function NeoTabs<T extends string>({
	options,
	value,
	onChange,
	accent = 'blue',
	className,
	'aria-label': ariaLabel,
}: NeoTabsProps<T>) {
	return (
		<fieldset
			aria-label={ariaLabel}
			className={cn(
				'inline-flex gap-1 bg-background p-1',
				NEO_RADIUS,
				NEO_EDGE,
				className,
			)}
		>
			{options.map((option) => {
				const active = option.value === value;
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={active}
						title={option.title}
						onClick={() => onChange(option.value)}
						className={cn(
							'rounded-[2px] border-2 px-2.5 py-1 text-[11px] font-semibold uppercase',
							'tracking-[0.08em] transition-all duration-100',
							active
								? cn(
										ACCENT_FILL[accent],
										ACCENT_ON[accent],
										ACCENT_CAST_BORDER[accent],
										ACCENT_CAST_SHADOW[accent],
									)
								: 'border-transparent text-muted-foreground hover:border-[rgb(var(--np-edge))] hover:text-foreground',
						)}
					>
						{option.label}
					</button>
				);
			})}
		</fieldset>
	);
}

export interface NeoIconButtonProps
	extends ButtonHTMLAttributes<HTMLButtonElement> {
	label: string;
	children: ReactNode;
}

/** Square hard-edged action; translates into its shadow on press. */
export function NeoIconButton({
	label,
	children,
	className,
	...rest
}: NeoIconButtonProps) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			className={cn(
				'inline-flex size-8 shrink-0 items-center justify-center bg-card text-foreground',
				'transition-[transform,box-shadow] duration-100',
				'active:translate-x-[3px] active:translate-y-[3px] active:shadow-none',
				'hover:bg-muted disabled:pointer-events-none disabled:opacity-50',
				NEO_RADIUS,
				NEO_EDGE,
				ELEVATION.sm,
				className,
			)}
			{...rest}
		>
			{children}
		</button>
	);
}

/** Legend swatch: a small hard square in the accent colour. */
export function NeoSwatch({
	accent,
	label,
}: {
	accent: NeoAccent;
	label: string;
}) {
	return (
		<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
			<span
				className={cn(
					'size-2.5 border-2',
					ACCENT_FILL[accent],
					ACCENT_CAST_BORDER[accent],
				)}
			/>
			<span>{label}</span>
		</span>
	);
}

/** Faint 44px NeoPop grid, used behind empty states. */
export const NEO_GRID_BG =
	'bg-[linear-gradient(to_right,rgb(var(--np-edge)/0.09)_1px,transparent_1px),linear-gradient(to_bottom,rgb(var(--np-edge)/0.09)_1px,transparent_1px)] bg-[length:44px_44px]';

export function NeoEmptyState({ children }: { children: ReactNode }) {
	return (
		<div
			className={cn(
				'px-6 py-10 text-center text-[12px] text-muted-foreground',
				NEO_RADIUS,
				NEO_EDGE,
				NEO_GRID_BG,
			)}
		>
			{children}
		</div>
	);
}
