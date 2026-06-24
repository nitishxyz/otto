import { mix } from './color';
import type { OttoTheme, ThemeId, ThemeMode, ThemeSyntax } from './types';

/**
 * Expands a small set of base syntax colors into the full {@link ThemeSyntax}
 * map so individual theme files only need to specify the meaningful tokens.
 */
export function syntax(colors: {
	keyword: string;
	string: string;
	comment: string;
	number: string;
	function: string;
	type: string;
	variable: string;
	property: string;
	operator: string;
	punctuation: string;
}): ThemeSyntax {
	return {
		keyword: colors.keyword,
		keywordImport: colors.keyword,
		keywordOperator: colors.operator,
		string: colors.string,
		comment: colors.comment,
		number: colors.number,
		boolean: colors.number,
		constant: colors.number,
		function: colors.function,
		functionCall: colors.function,
		functionMethodCall: colors.function,
		type: colors.type,
		constructor: colors.type,
		variable: colors.variable,
		variableMember: colors.property,
		property: colors.property,
		operator: colors.operator,
		punctuation: colors.punctuation,
		punctuationBracket: colors.punctuation,
		punctuationDelimiter: colors.comment,
		default: colors.variable,
		markupHeading: colors.function,
		markupHeading1: colors.string,
		markupHeading2: colors.property,
		markupBold: colors.keyword,
		markupStrong: colors.keyword,
		markupItalic: colors.operator,
		markupList: colors.operator,
		markupQuote: colors.type,
		markupRaw: colors.string,
		markupRawBlock: colors.string,
		markupLink: colors.property,
		markupLinkUrl: colors.property,
	};
}

export interface PaletteInput {
	id: ThemeId;
	displayName: string;
	mode: ThemeMode;
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
	magenta: string;
	syntax: ThemeSyntax;
	/** Optional exact CSS variable overrides (see {@link OttoTheme.cssVariables}). */
	cssVariables?: Record<string, string>;
}

/**
 * Builds a full {@link OttoTheme} from a compact palette definition, deriving
 * the secondary surface/diff/badge colors shared by every theme.
 */
export function theme(input: PaletteInput): OttoTheme {
	return {
		id: input.id,
		displayName: input.displayName,
		mode: input.mode,
		cssVariables: input.cssVariables,
		colors: {
			bg: input.bg,
			bgDark: input.bgDark,
			bgHighlight: input.bgHighlight,
			bgSubtle: input.bgSubtle,
			fg: input.fg,
			fgBright: input.fgBright,
			fgMuted: input.fgMuted,
			fgDark: input.fgDark,
			fgDimmed: input.fgDimmed,
			blue: input.blue,
			green: input.green,
			red: input.red,
			yellow: input.yellow,
			purple: input.purple,
			cyan: input.cyan,
			orange: input.orange,
			teal: input.cyan,
			magenta: input.magenta,
			border: input.fgDimmed,
			borderActive: input.yellow,
			borderSubtle: input.bgHighlight,
			toolBg: input.bgDark,
			toolFg: input.fgDark,
			toolIcon: input.fgDimmed,
			toolName: input.fgDark,
			toolArgs: input.fgDimmed,
			userBg: input.bg,
			assistantBg: input.bgDark,
			userBadge: input.blue,
			assistantBadge: input.purple,
			systemBadge: input.fgDark,
			streamDot: input.green,
			errorBg: mix(input.bg, input.red, input.mode === 'dark' ? 0.22 : 0.12),
			diffAddedBg: mix(
				input.bg,
				input.green,
				input.mode === 'dark' ? 0.2 : 0.12,
			),
			diffRemovedBg: mix(
				input.bg,
				input.red,
				input.mode === 'dark' ? 0.2 : 0.12,
			),
			diffContextBg: 'transparent',
			diffAddedSign: input.green,
			diffRemovedSign: input.red,
			diffLineNumberFg: input.fgDark,
		},
		syntax: input.syntax,
	};
}
