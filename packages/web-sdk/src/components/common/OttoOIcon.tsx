import type { SVGProps } from 'react';

export interface OttoMarkProps extends SVGProps<SVGSVGElement> {
	size?: number | string;
	/** Accessible label. When omitted the mark is decorative (aria-hidden). */
	label?: string;
}

/**
 * The otto brand mark: a ship wheel rendered in `currentColor`.
 * Decorative by default; pass `label` for an accessible standalone mark.
 */
export function OttoMark({ size = 24, label, ...props }: OttoMarkProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			role={label ? 'img' : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
			{...props}
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

/**
 * Compatibility alias for the previous "O" glyph icon. Renders the ShipWheel
 * otto mark.
 */
export function OttoOIcon({ className }: { className?: string }) {
	return <OttoMark className={className} />;
}

const O_GLYPH =
	'M0 27Q0 20 7 20L33 20Q40 20 40 27L40 49Q40 56 33 56L7 56Q0 56 0 49Z M10 33Q10 30 13 30L27 30Q30 30 30 33L30 43Q30 46 27 46L13 46Q10 46 10 43Z';
const T_ONE_GLYPH =
	'M57 11Q57 8 60 8L64 8Q67 8 67 11L67 17Q67 20 70 20L72 20Q75 20 75 23L75 27Q75 30 72 30L70 30Q67 30 67 33L67 43Q67 46 70 46L73 46Q76 46 76 49L76 53Q76 56 73 56L60 56Q57 56 57 53L57 32.5Q57 30 54.5 30Q52 30 52 27.5L52 22.5Q52 20 54.5 20Q57 20 57 17.5Z';
const T_TWO_GLYPH =
	'M93 11Q93 8 96 8L100 8Q103 8 103 11L103 17Q103 20 106 20L108 20Q111 20 111 23L111 27Q111 30 108 30L106 30Q103 30 103 33L103 43Q103 46 106 46L109 46Q112 46 112 49L112 53Q112 56 109 56L96 56Q93 56 93 53L93 32.5Q93 30 90.5 30Q88 30 88 27.5L88 22.5Q88 20 90.5 20Q93 20 93 17.5Z';
const O_TWO_GLYPH =
	'M124 27Q124 20 131 20L157 20Q164 20 164 27L164 49Q164 56 157 56L131 56Q124 56 124 49Z M134 33Q134 30 137 30L151 30Q154 30 154 33L154 43Q154 46 151 46L137 46Q134 46 134 43Z';

const WORDMARK_GLYPHS = [
	{ key: 'o1', d: O_GLYPH, fill: '#4865cc', cast: '#283c8c', evenOdd: true },
	{
		key: 't1',
		d: T_ONE_GLYPH,
		fill: '#c9403a',
		cast: '#84241f',
		evenOdd: false,
	},
	{
		key: 't2',
		d: T_TWO_GLYPH,
		fill: '#c9403a',
		cast: '#84241f',
		evenOdd: false,
	},
	{
		key: 'o2',
		d: O_TWO_GLYPH,
		fill: '#62ad8b',
		cast: '#346852',
		evenOdd: true,
	},
] as const;

export interface OttoWordmarkProps {
	height?: number;
	className?: string;
	/** Press the face into its hard extrusion on hover. */
	animated?: boolean;
	/** Accessible label. Pass an empty string when a parent labels the mark. */
	label?: string;
}

/** Renders the multicolor NeoPop otto wordmark used across product surfaces. */
export function OttoWordmark({
	height = 16,
	className,
	animated = true,
	label = 'otto',
}: OttoWordmarkProps) {
	const width = Math.round(height * (171 / 55));
	const svgClassName = [animated && 'otto-wordmark-interactive', className]
		.filter(Boolean)
		.join(' ');
	return (
		<svg
			width={width}
			height={height}
			viewBox="-2 6 171 55"
			className={svgClassName || undefined}
			aria-label={label || undefined}
			aria-hidden={label ? undefined : true}
			role={label ? 'img' : undefined}
		>
			{animated && (
				<style>{`
					.otto-wordmark-face { transition: transform 140ms cubic-bezier(0.2, 0.8, 0.3, 1); }
					@media (hover: hover) and (pointer: fine) {
						.otto-wordmark-interactive:hover .otto-wordmark-face { transform: translate(3px, 3px); }
					}
					@media (prefers-reduced-motion: reduce) {
						.otto-wordmark-face { transition: none; }
						.otto-wordmark-interactive:hover .otto-wordmark-face { transform: none; }
					}
				`}</style>
			)}
			<g transform="translate(3 3)" stroke="none">
				{WORDMARK_GLYPHS.map((glyph) => (
					<path
						key={glyph.key}
						d={glyph.d}
						fill={glyph.cast}
						fillRule={glyph.evenOdd ? 'evenodd' : 'nonzero'}
					/>
				))}
			</g>
			<g className="otto-wordmark-face" stroke="none">
				{WORDMARK_GLYPHS.map((glyph) => (
					<path
						key={glyph.key}
						d={glyph.d}
						fill={glyph.fill}
						fillRule={glyph.evenOdd ? 'evenodd' : 'nonzero'}
					/>
				))}
			</g>
		</svg>
	);
}

export interface OttoRouterWordmarkProps {
	height?: number;
	className?: string;
	/** Press the Otto face into its hard extrusion on hover. */
	animated?: boolean;
}

/** Renders the NeoPop OttoRouter lockup used by the OttoRouter application. */
export function OttoRouterWordmark({
	height = 16,
	className,
	animated = true,
}: OttoRouterWordmarkProps) {
	const xHeight = (36 / 55) * height;
	const fontSize = xHeight / 0.516;
	const baselineFromBottom = (5 / 55) * height;
	const classNames = [
		'inline-flex items-end',
		animated && 'otto-router-wordmark-interactive',
		className,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<span className={classNames} aria-label="OttoRouter" role="img">
			{animated && (
				<style>{`
					.otto-router-wordmark-interactive .otto-wordmark-face { transition: transform 140ms cubic-bezier(0.2, 0.8, 0.3, 1); }
					@media (hover: hover) and (pointer: fine) {
						.otto-router-wordmark-interactive:hover .otto-wordmark-face { transform: translate(3px, 3px); }
					}
					@media (prefers-reduced-motion: reduce) {
						.otto-router-wordmark-interactive .otto-wordmark-face { transition: none; }
						.otto-router-wordmark-interactive:hover .otto-wordmark-face { transform: none; }
					}
				`}</style>
			)}
			<OttoWordmark height={height} animated={false} label="" />
			<span
				aria-hidden="true"
				className="font-mono font-bold leading-none tracking-[-0.055em]"
				style={{
					fontSize: `${fontSize}px`,
					marginLeft: `${height * 0.14}px`,
					marginBottom: `${baselineFromBottom - fontSize * 0.125}px`,
				}}
			>
				router
			</span>
		</span>
	);
}

/** Compatibility export for previous text-only wordmark call sites. */
export function OttoTextWordmark(props: OttoWordmarkProps) {
	return <OttoWordmark {...props} />;
}
