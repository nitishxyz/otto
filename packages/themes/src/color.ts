export function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const clean = hex.replace('#', '');
	const normalized =
		clean.length === 3
			? clean
					.split('')
					.map((char) => char + char)
					.join('')
			: clean;
	return {
		r: Number.parseInt(normalized.slice(0, 2), 16),
		g: Number.parseInt(normalized.slice(2, 4), 16),
		b: Number.parseInt(normalized.slice(4, 6), 16),
	};
}

export function rgbToHex(r: number, g: number, b: number): string {
	return `#${[r, g, b]
		.map((value) => value.toString(16).padStart(2, '0'))
		.join('')}`;
}

export function hexToHslTriplet(hex: string): string {
	const { r, g, b } = hexToRgb(hex);
	const r1 = r / 255;
	const g1 = g / 255;
	const b1 = b / 255;
	const max = Math.max(r1, g1, b1);
	const min = Math.min(r1, g1, b1);
	let h = 0;
	let s = 0;
	const l = (max + min) / 2;

	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r1:
				h = (g1 - b1) / d + (g1 < b1 ? 6 : 0);
				break;
			case g1:
				h = (b1 - r1) / d + 2;
				break;
			default:
				h = (r1 - g1) / d + 4;
				break;
		}
		h /= 6;
	}

	return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function mix(base: string, accent: string, amount: number): string {
	const a = hexToRgb(base);
	const b = hexToRgb(accent);
	const r = Math.round(a.r * (1 - amount) + b.r * amount);
	const g = Math.round(a.g * (1 - amount) + b.g * amount);
	const bl = Math.round(a.b * (1 - amount) + b.b * amount);
	return rgbToHex(r, g, bl);
}
