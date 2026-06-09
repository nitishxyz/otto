import chalk from 'chalk';

const hex = chalk.hex.bind(chalk);
const bgHex = chalk.bgHex.bind(chalk);

export const c = {
	dim: chalk.dim,
	bold: chalk.bold,
	italic: chalk.italic,

	blue: hex('#7aa2f7'),
	cyan: hex('#7dcfff'),
	green: hex('#9ece6a'),
	yellow: hex('#e0af68'),
	red: hex('#f7768e'),
	purple: hex('#bb9af7'),
	magenta: hex('#c678dd'),
	orange: hex('#ff9e64'),
	teal: hex('#73daca'),
	white: hex('#e6edf3'),
	gray: hex('#565f89'),

	fgBright: hex('#e6edf3'),
	fgMuted: hex('#a9b1d6'),
	fgDark: hex('#565f89'),
	fgDimmed: hex('#3b4261'),

	blueBold: hex('#7aa2f7').bold,
	greenBold: hex('#9ece6a').bold,
	yellowBold: hex('#e0af68').bold,
	redBold: hex('#f7768e').bold,
	cyanBold: hex('#7dcfff').bold,
	magentaBold: hex('#c678dd').bold,
	purpleBold: hex('#bb9af7').bold,

	dimBlue: hex('#7aa2f7').dim,
	dimGreen: hex('#9ece6a').dim,
	dimYellow: hex('#e0af68').dim,
	dimRed: hex('#f7768e').dim,
	dimCyan: hex('#7dcfff').dim,

	greenDim: chalk.dim.green,
	redDim: chalk.dim.red,

	diffAdded: hex('#9ece6a'),
	diffRemoved: hex('#f7768e'),
	diffAddedBg: bgHex('#1a3a1a'),
	diffRemovedBg: bgHex('#3a1a1a'),

	toolBg: bgHex('#1e2030'),
};

export const TOOL_COLORS: Record<string, (s: string) => string> = {
	read: c.blue,
	ls: c.blue,
	tree: c.cyan,
	search: c.blue,
	glob: c.cyan,
	git_status: c.blue,
	git_diff: c.blue,

	write: c.green,
	apply_patch: c.green,
	git_commit: c.green,

	shell: c.yellow,
	bash: c.yellow,
	terminal: c.yellow,

	websearch: c.magenta,

	finish: c.dim,
	skill: c.magenta,
	progress_update: c.cyan,
	update_todos: c.cyan,
};

export function toolColor(name: string): (s: string) => string {
	return TOOL_COLORS[name] ?? c.cyan;
}

export const ICONS = {
	arrow: '→',
	check: '✓',
	cross: '✗',
	dot: '·',
	ellipsis: '…',
	pending: '○',
	spinner: '→',
	plus: '+',
	minus: '-',
	pipe: '│',
	todo: '☐',
	todoDone: '☑',
	star: '✦',
	warning: '⚠',
};

export function formatMs(ms?: number): string {
	if (ms === undefined) return '';
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
}

export function indent(s: string, spaces = 4): string {
	const pad = ' '.repeat(spaces);
	return s
		.split('\n')
		.map((l) => `${pad}${l}`)
		.join('\n');
}

export function pluralize(
	n: number,
	singular: string,
	plural?: string,
): string {
	return n === 1 ? singular : (plural ?? `${singular}s`);
}
