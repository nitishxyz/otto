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

const OTTO_WORDMARK_TEXT_PATH =
	'M192.877 257.682C192.877 263.287 191.783 268.551 189.596 273.473C187.545 278.395 184.674 282.701 180.982 286.393C177.428 289.947 173.189 292.818 168.268 295.006C163.482 297.057 158.287 298.082 152.682 298.082H44.1953C38.7266 298.082 33.5312 297.057 28.6094 295.006C23.6875 292.818 19.3809 289.947 15.6895 286.393C12.1348 282.701 9.26367 278.395 7.07617 273.473C5.02539 268.551 4 263.287 4 257.682V120.074C4 114.469 5.02539 109.205 7.07617 104.283C9.26367 99.3613 12.1348 95.123 15.6895 91.5684C19.3809 87.877 23.6875 85.0059 28.6094 82.9551C33.5312 80.7676 38.7266 79.6738 44.1953 79.6738H152.682C158.287 79.6738 163.482 80.7676 168.268 82.9551C173.189 85.0059 177.428 87.877 180.982 91.5684C184.674 95.123 187.545 99.3613 189.596 104.283C191.783 109.205 192.877 114.469 192.877 120.074V257.682ZM44.1953 120.074V257.682H152.682V120.074H44.1953ZM331.715 4V298.082H289.674V46.041H239.225V4H331.715ZM478.961 4V298.082H436.92V46.041H386.471V4H478.961ZM743.717 257.682C743.717 263.287 742.623 268.551 740.436 273.473C738.385 278.395 735.514 282.701 731.822 286.393C728.268 289.947 724.029 292.818 719.107 295.006C714.322 297.057 709.127 298.082 703.521 298.082H595.035C589.566 298.082 584.371 297.057 579.449 295.006C574.527 292.818 570.221 289.947 566.529 286.393C562.975 282.701 560.104 278.395 557.916 273.473C555.865 268.551 554.84 263.287 554.84 257.682V120.074C554.84 114.469 555.865 109.205 557.916 104.283C560.104 99.3613 562.975 95.123 566.529 91.5684C570.221 87.877 574.527 85.0059 579.449 82.9551C584.371 80.7676 589.566 79.6738 595.035 79.6738H703.521C709.127 79.6738 714.322 80.7676 719.107 82.9551C724.029 85.0059 728.268 87.877 731.822 91.5684C735.514 95.123 738.385 99.3613 740.436 104.283C742.623 109.205 743.717 114.469 743.717 120.074V257.682ZM595.035 120.074V257.682H703.521V120.074H595.035Z';

export interface OttoWordmarkProps {
	height?: number;
	className?: string;
}

/**
 * Otto brand lockup: the ShipWheel mark beside the original otto wordmark
 * glyphs, composed in a single SVG so spacing and alignment hold at any size.
 * The mark is sized to the lowercase x-height band and sits a tight half
 * mark-width from the text.
 */
export function OttoWordmark({ height = 16, className }: OttoWordmarkProps) {
	const width = Math.round(height * (1098 / 303));
	return (
		<svg
			width={width}
			height={height}
			viewBox="0 0 1098 303"
			className={className}
			fill="currentColor"
			aria-label="otto"
			role="img"
		>
			<g
				fill="none"
				stroke="currentColor"
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
				transform="translate(0 68.878) scale(10)"
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
			</g>
			<path d={OTTO_WORDMARK_TEXT_PATH} transform="translate(350 0)" />
		</svg>
	);
}
