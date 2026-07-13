import { Resvg } from '@resvg/resvg-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const BRAND_DIR = resolve(ROOT, 'assets/brand');
const TILE_COLOR = '#141416';
const MARK_COLOR = '#f7f7f8';
const SHIPWHEEL_PATHS = [
	'M12 2v7.5',
	'm19 5-5.23 5.23',
	'M22 12h-7.5',
	'm19 19-5.23-5.23',
	'M12 14.5V22',
	'M10.23 13.77 5 19',
	'M9.5 12H2',
	'M10.23 10.23 5 5',
] as const;
const SHIPWHEEL_CIRCLES = [
	'<circle cx="12" cy="12" r="8"/>',
	'<circle cx="12" cy="12" r="2.5"/>',
] as const;

const macIcons = [
	['icon_16x16.png', 16],
	['icon_16x16@2x.png', 32],
	['icon_32x32.png', 32],
	['icon_32x32@2x.png', 64],
	['icon_128x128.png', 128],
	['icon_128x128@2x.png', 256],
	['icon_256x256.png', 256],
	['icon_256x256@2x.png', 512],
	['icon_512x512.png', 512],
	['icon_512x512@2x.png', 1024],
] as const;

const faviconPaths = [
	'apps/web/public/favicon.svg',
	'apps/desktop/public/favicon.svg',
	'apps/preview-web/public/favicon.svg',
	'apps/landing/public/favicon.svg',
	'apps/launcher/public/favicon.svg',
	'apps/canvas/public/favicon.svg',
] as const;

const expectedPaths = new Set([
	...macIcons.map(
		([name]) => `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/${name}`,
	),
	'apps/mobile/assets/images/icon.png',
	'apps/mobile/assets/images/favicon.png',
	'apps/mobile/assets/images/splash-icon.png',
	'apps/mobile/assets/images/android-icon-foreground.png',
	'apps/mobile/assets/images/android-icon-background.png',
	'apps/mobile/assets/images/android-icon-monochrome.png',
	'apps/web/public/apple-touch-icon.png',
	...faviconPaths,
	'apps/web/public/pwa-icon.svg',
]);

function validateShipwheel(mark: string): string {
	const viewBox = mark.match(/\bviewBox="([^"]+)"/)?.[1];
	if (viewBox !== '0 0 24 24') {
		throw new Error(
			`shipwheel-mark.svg viewBox mismatch: expected "0 0 24 24", got ${JSON.stringify(viewBox)}`,
		);
	}

	const paths = [...mark.matchAll(/<path\s+d="([^"]+)"\s*\/>/g)].map(
		(match) => match[1],
	);
	if (
		paths.length !== SHIPWHEEL_PATHS.length ||
		paths.some((path, index) => path !== SHIPWHEEL_PATHS[index])
	) {
		throw new Error(
			`shipwheel-mark.svg path geometry mismatch:\nexpected ${JSON.stringify(SHIPWHEEL_PATHS)}\ngot ${JSON.stringify(paths)}`,
		);
	}

	const circles = [...mark.matchAll(/<circle\s+[^>]*\/>/g)].map(
		(match) => match[0],
	);
	if (
		circles.length !== SHIPWHEEL_CIRCLES.length ||
		circles.some((circle, index) => circle !== SHIPWHEEL_CIRCLES[index])
	) {
		throw new Error(
			`shipwheel-mark.svg circle geometry mismatch:\nexpected ${JSON.stringify(SHIPWHEEL_CIRCLES)}\ngot ${JSON.stringify(circles)}`,
		);
	}

	const body = mark.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/)?.[1]?.trim();
	if (!body) {
		throw new Error('shipwheel-mark.svg has no SVG body');
	}
	const geometryElements = [...body.matchAll(/<([a-z]+)\b/g)].map(
		(match) => match[1],
	);
	if (
		geometryElements.some(
			(element) => element !== 'circle' && element !== 'path',
		)
	) {
		throw new Error(
			`shipwheel-mark.svg contains unexpected geometry: ${geometryElements.join(', ')}`,
		);
	}
	return body;
}

function squareSvg(size: number, body: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>\n`;
}

function markLayerSvg(
	size: number,
	geometry: string,
	visualFraction: number,
	color = MARK_COLOR,
): string {
	const scale = (size * visualFraction) / 20;
	const offset = (size - 24 * scale) / 2;
	return squareSvg(
		size,
		`<g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n${geometry}\n</g>`,
	);
}

function solidSvg(size: number, color: string): string {
	return squareSvg(
		size,
		`<rect width="${size}" height="${size}" fill="${color}"/>`,
	);
}

function faviconSvg(geometry: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <style>
    :root { color: #141416; }
    @media (prefers-color-scheme: dark) { :root { color: #f7f7f8; } }
  </style>
${geometry}
</svg>
`;
}

function stripPngMetadata(png: Uint8Array): Uint8Array {
	const signature = png.subarray(0, 8);
	const chunks: Uint8Array[] = [signature];
	let offset = 8;
	while (offset < png.length) {
		if (offset + 12 > png.length) {
			throw new Error('resvg produced a truncated PNG');
		}
		const length = new DataView(
			png.buffer,
			png.byteOffset + offset,
			4,
		).getUint32(0);
		const end = offset + 12 + length;
		if (end > png.length) {
			throw new Error('resvg produced an invalid PNG chunk');
		}
		const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
		if (type === 'IHDR' || type === 'IDAT' || type === 'IEND') {
			chunks.push(png.subarray(offset, end));
		}
		offset = end;
	}
	const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
	const stripped = new Uint8Array(totalLength);
	let writeOffset = 0;
	for (const chunk of chunks) {
		stripped.set(chunk, writeOffset);
		writeOffset += chunk.length;
	}
	return stripped;
}

function renderPng(svg: string, size: number): Uint8Array {
	const png = new Resvg(svg, {
		fitTo: { mode: 'width', value: size },
	})
		.render()
		.asPng();
	return stripPngMetadata(png);
}

function addOutput(
	outputs: Map<string, Uint8Array>,
	path: string,
	content: string | Uint8Array,
): void {
	if (!expectedPaths.has(path)) {
		throw new Error(`Refusing to generate unexpected output: ${path}`);
	}
	if (outputs.has(path)) {
		throw new Error(`Duplicate generated output: ${path}`);
	}
	outputs.set(
		path,
		typeof content === 'string' ? new TextEncoder().encode(content) : content,
	);
}

async function buildOutputs(): Promise<Map<string, Uint8Array>> {
	const [mark, appIcon, ottoLockup, ottoRouterLockup] = await Promise.all([
		readFile(resolve(BRAND_DIR, 'shipwheel-mark.svg'), 'utf8'),
		readFile(resolve(BRAND_DIR, 'otto-app-icon.svg'), 'utf8'),
		readFile(resolve(BRAND_DIR, 'otto-lockup.svg'), 'utf8'),
		readFile(resolve(BRAND_DIR, 'ottorouter-lockup.svg'), 'utf8'),
	]);
	if (!appIcon.trim() || !ottoLockup.trim() || !ottoRouterLockup.trim()) {
		throw new Error('One or more canonical brand SVGs are empty');
	}
	const geometry = validateShipwheel(mark);
	const outputs = new Map<string, Uint8Array>();

	for (const [name, size] of macIcons) {
		addOutput(
			outputs,
			`apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/${name}`,
			renderPng(appIcon, size),
		);
	}

	addOutput(
		outputs,
		'apps/mobile/assets/images/icon.png',
		renderPng(appIcon, 1024),
	);
	addOutput(
		outputs,
		'apps/mobile/assets/images/favicon.png',
		renderPng(appIcon, 48),
	);
	addOutput(
		outputs,
		'apps/mobile/assets/images/splash-icon.png',
		renderPng(markLayerSvg(1024, geometry, 0.52), 1024),
	);
	addOutput(
		outputs,
		'apps/mobile/assets/images/android-icon-foreground.png',
		renderPng(markLayerSvg(512, geometry, 0.66), 512),
	);
	addOutput(
		outputs,
		'apps/mobile/assets/images/android-icon-background.png',
		renderPng(solidSvg(512, TILE_COLOR), 512),
	);
	addOutput(
		outputs,
		'apps/mobile/assets/images/android-icon-monochrome.png',
		renderPng(markLayerSvg(432, geometry, 0.66, '#ffffff'), 432),
	);
	addOutput(
		outputs,
		'apps/web/public/apple-touch-icon.png',
		renderPng(appIcon, 180),
	);

	const favicon = faviconSvg(geometry);
	for (const path of faviconPaths) {
		addOutput(outputs, path, favicon);
	}
	addOutput(outputs, 'apps/web/public/pwa-icon.svg', appIcon);

	if (outputs.size !== expectedPaths.size) {
		const missing = [...expectedPaths].filter((path) => !outputs.has(path));
		throw new Error(
			`Generator did not produce expected outputs: ${missing.join(', ')}`,
		);
	}
	return outputs;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const check = args.includes('--check');
	const unknownArgs = args.filter((arg) => arg !== '--check');
	if (unknownArgs.length > 0) {
		throw new Error(`Unknown arguments: ${unknownArgs.join(', ')}`);
	}

	const outputs = await buildOutputs();
	const stale: string[] = [];
	for (const [path, content] of outputs) {
		const absolutePath = resolve(ROOT, path);
		if (check) {
			const existing = await readFile(absolutePath).catch(() => undefined);
			if (!existing || !existing.equals(content)) {
				stale.push(path);
			}
			console.log(`checked ${path}`);
		} else {
			await mkdir(dirname(absolutePath), { recursive: true });
			await writeFile(absolutePath, content);
			console.log(`generated ${path}`);
		}
	}
	if (stale.length > 0) {
		throw new Error(`Stale generated brand assets:\n${stale.join('\n')}`);
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
