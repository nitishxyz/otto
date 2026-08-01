import { cn } from './cn';

export interface NeoCodeMarkGeometry {
	height: number;
	arm: number;
	thickness: number;
	gap: number;
	corner: number;
	depth: number;
}

export interface NeoCodeMarkPalette {
	left: string;
	leftCast: string;
	right: string;
	rightCast: string;
}

export interface NeoCodeMarkProps {
	geometry: NeoCodeMarkGeometry;
	palette: NeoCodeMarkPalette;
	displayHeight?: number;
	className?: string;
	label?: string;
}

function safeGeometry(geometry: NeoCodeMarkGeometry): NeoCodeMarkGeometry {
	const height = Math.max(48, geometry.height);
	const arm = Math.max(16, Math.min(geometry.arm, height * 0.8));
	const thickness = Math.max(4, Math.min(geometry.thickness, arm * 0.72));
	const corner = Math.max(
		0,
		Math.min(geometry.corner, thickness * 0.75, (arm - thickness) * 0.75),
	);

	return {
		height,
		arm,
		thickness,
		gap: Math.max(0, geometry.gap),
		corner,
		depth: Math.max(0, geometry.depth),
	};
}

function leftBracketPath(geometry: NeoCodeMarkGeometry): string {
	const { height, arm, thickness, corner } = safeGeometry(geometry);
	const bottom = height - thickness;
	return [
		`M ${arm} 0`,
		`H ${corner}`,
		`Q 0 0 0 ${corner}`,
		`V ${height - corner}`,
		`Q 0 ${height} ${corner} ${height}`,
		`H ${arm}`,
		`V ${bottom}`,
		`H ${thickness + corner}`,
		`Q ${thickness} ${bottom} ${thickness} ${bottom - corner}`,
		`V ${thickness + corner}`,
		`Q ${thickness} ${thickness} ${thickness + corner} ${thickness}`,
		`H ${arm}`,
		'Z',
	].join(' ');
}

function dimensions(geometry: NeoCodeMarkGeometry) {
	const safe = safeGeometry(geometry);
	return {
		...safe,
		width: safe.arm * 2 + safe.gap + safe.depth,
		viewHeight: safe.height + safe.depth,
	};
}

/** Builds a portable SVG file using the same custom geometry as the component. */
export function buildNeoCodeMarkSvg(
	geometry: NeoCodeMarkGeometry,
	palette: NeoCodeMarkPalette,
): string {
	const shape = dimensions(geometry);
	const path = leftBracketPath(shape);
	const mirror = `translate(${shape.arm * 2 + shape.gap} 0) scale(-1 1)`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${shape.width} ${shape.viewHeight}" role="img" aria-label="Custom code mark"><g transform="translate(${shape.depth} ${shape.depth})"><path d="${path}" fill="${palette.leftCast}"/><path d="${path}" fill="${palette.rightCast}" transform="${mirror}"/></g><path d="${path}" fill="${palette.left}"/><path d="${path}" fill="${palette.right}" transform="${mirror}"/></svg>`;
}

/** A custom-drawn vector code mark with adjustable proportions and extrusion. */
export function NeoCodeMark({
	geometry,
	palette,
	displayHeight = 180,
	className,
	label = 'Custom code mark',
}: NeoCodeMarkProps) {
	const shape = dimensions(geometry);
	const path = leftBracketPath(shape);
	const mirror = `translate(${shape.arm * 2 + shape.gap} 0) scale(-1 1)`;
	const displayWidth = (displayHeight * shape.width) / shape.viewHeight;

	return (
		<svg
			viewBox={`0 0 ${shape.width} ${shape.viewHeight}`}
			width={displayWidth}
			height={displayHeight}
			className={cn('block max-w-full', className)}
			role="img"
			aria-label={label}
		>
			<title>{label}</title>
			<g transform={`translate(${shape.depth} ${shape.depth})`}>
				<path d={path} fill={palette.leftCast} />
				<path d={path} fill={palette.rightCast} transform={mirror} />
			</g>
			<path d={path} fill={palette.left} />
			<path d={path} fill={palette.right} transform={mirror} />
		</svg>
	);
}
