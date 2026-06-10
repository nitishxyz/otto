export const IGNORE_PATTERNS: string[] = [
	'node_modules/',
	'__pycache__/',
	'.git/',
	'dist/',
	'build/',
	'target/',
	'vendor/',
	'bin/',
	'obj/',
	'.idea/',
	'.vscode/',
	'.zig-cache/',
	'zig-out',
	'.coverage',
	'coverage/',
	'vendor/',
	'tmp/',
	'temp/',
	'.cache/',
	'cache/',
	'logs/',
	'.venv/',
	'venv/',
	'env/',
];

export function defaultIgnoreGlobs(extra?: string[]): string[] {
	const base = IGNORE_PATTERNS.flatMap((p) => {
		const pattern = p.replace(/\/$/, '');
		return [`${pattern}/**`, `**/${pattern}/**`];
	});
	if (Array.isArray(extra) && extra.length) return base.concat(extra);
	return base;
}

export function toIgnoredBasenames(extra?: string[]): Set<string> {
	const names = new Set<string>();
	for (const p of IGNORE_PATTERNS) {
		const n = p.replace(/\/$/, '');
		if (n) names.add(n);
	}
	for (const p of extra ?? []) {
		const n = String(p).replace(/^!/, '').replace(/\/$/, '');
		if (n) names.add(n);
	}
	return names;
}
