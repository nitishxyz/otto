export type ThemeMode = 'light' | 'dark';

export interface ThemeSyntax {
	keyword: string;
	keywordImport: string;
	keywordOperator: string;
	string: string;
	comment: string;
	number: string;
	boolean: string;
	constant: string;
	function: string;
	functionCall: string;
	functionMethodCall: string;
	type: string;
	constructor: string;
	variable: string;
	variableMember: string;
	property: string;
	operator: string;
	punctuation: string;
	punctuationBracket: string;
	punctuationDelimiter: string;
	default: string;
	markupHeading: string;
	markupHeading1: string;
	markupHeading2: string;
	markupBold: string;
	markupStrong: string;
	markupItalic: string;
	markupList: string;
	markupQuote: string;
	markupRaw: string;
	markupRawBlock: string;
	markupLink: string;
	markupLinkUrl: string;
}

export interface TuiThemeColors {
	bg: string;
	bgDark: string;
	bgHighlight: string;
	bgSubtle: string;
	fg: string;
	fgBright: string;
	fgMuted: string;
	fgDark: string;
	fgDimmed: string;
	blue: string;
	green: string;
	red: string;
	yellow: string;
	purple: string;
	cyan: string;
	orange: string;
	teal: string;
	magenta: string;
	border: string;
	borderActive: string;
	borderSubtle: string;
	toolBg: string;
	toolFg: string;
	toolIcon: string;
	toolName: string;
	toolArgs: string;
	userBg: string;
	assistantBg: string;
	userBadge: string;
	assistantBadge: string;
	systemBadge: string;
	streamDot: string;
	errorBg: string;
	diffAddedBg: string;
	diffRemovedBg: string;
	diffContextBg: string;
	diffAddedSign: string;
	diffRemovedSign: string;
	diffLineNumberFg: string;
}

export interface TuiTheme {
	name: ThemeId;
	displayName: string;
	colors: TuiThemeColors;
	syntax: ThemeSyntax;
}

export interface OttoTheme {
	id: ThemeId;
	displayName: string;
	mode: ThemeMode;
	colors: TuiThemeColors;
	syntax: ThemeSyntax;
	/**
	 * Optional explicit CSS variable overrides. Used by the first-party Otto
	 * themes to preserve exact legacy colors instead of deriving them from the
	 * shared palette. When omitted, CSS variables are generated from `colors`.
	 */
	cssVariables?: Record<string, string>;
}

export const themeIds = [
	'otto-dark',
	'otto-light',
	'rose-pine',
	'rose-pine-moon',
	'rose-pine-dawn',
	'ayu-dark',
	'ayu-mirage',
	'ayu-light',
	'tokyo-night',
	'catppuccin-mocha',
	'nord',
	'gruvbox',
	'monokai',
	'dracula',
	'solarized-dark',
] as const;

export type ThemeId = (typeof themeIds)[number];
