import { getTheme, type OttoTheme, type ThemeId } from '@ottocode/themes';
import { registerCustomTheme } from '@pierre/diffs';
import type { ThemesType, ThemeTypes } from '@pierre/diffs';

const OTTO_DIFF_ADDITION = 'rgb(16 185 129)';
const OTTO_DIFF_DELETION = 'rgb(239 68 68)';

/**
 * Shiki theme registrations are global and immutable once registered, so each
 * Otto theme maps to exactly one stable Pierre theme name. Registering the same
 * name twice logs an error inside Pierre, hence the local guard.
 */
const registered = new Set<string>();

export function getPierreThemeName(themeId: ThemeId): string {
	return `otto-${themeId}`;
}

interface ShikiThemeSetting {
	scope?: string[];
	settings: { foreground?: string; background?: string; fontStyle?: string };
}

interface ShikiThemeRegistration {
	name: string;
	type: 'light' | 'dark';
	fg: string;
	bg: string;
	colors: Record<string, string>;
	settings: ShikiThemeSetting[];
}

function token(scope: string[], foreground: string): ShikiThemeSetting {
	return { scope, settings: { foreground } };
}

/**
 * Translates an Otto theme into a Shiki `ThemeRegistration`. Otto themes expose
 * semantic syntax tokens rather than TextMate scopes, so each token is fanned
 * out to the scopes Shiki grammars actually emit.
 */
export function ottoThemeToShikiTheme(
	theme: OttoTheme,
): ShikiThemeRegistration {
	const c = theme.colors;
	const s = theme.syntax;

	return {
		name: getPierreThemeName(theme.id),
		type: theme.mode,
		fg: c.fg,
		bg: c.bg,
		colors: {
			'editor.foreground': c.fg,
			'editor.background': c.bg,
			'editorLineNumber.foreground': c.diffLineNumberFg,
			// Read by Pierre to derive the addition/deletion/modified accent
			// variables for the diff chrome.
			'gitDecoration.addedResourceForeground': c.diffAddedSign,
			'gitDecoration.deletedResourceForeground': c.diffRemovedSign,
			'gitDecoration.modifiedResourceForeground': c.blue,
			'terminal.ansiGreen': c.green,
			'terminal.ansiRed': c.red,
			'terminal.ansiBlue': c.blue,
			'terminal.ansiYellow': c.yellow,
			'terminal.ansiCyan': c.cyan,
			'terminal.ansiMagenta': c.magenta,
		},
		settings: [
			{ settings: { foreground: c.fg, background: c.bg } },
			token(['comment', 'punctuation.definition.comment'], s.comment),
			token(
				[
					'string',
					'string.quoted',
					'string.template',
					'punctuation.definition.string',
				],
				s.string,
			),
			token(['constant.character.escape'], s.constant),
			token(['constant.numeric', 'constant.language.numeric'], s.number),
			token(['constant.language.boolean'], s.boolean),
			token(['constant', 'constant.language', 'constant.other'], s.constant),
			token(
				[
					'keyword',
					'keyword.control',
					'storage',
					'storage.type',
					'storage.modifier',
				],
				s.keyword,
			),
			token(
				[
					'keyword.control.import',
					'keyword.control.from',
					'keyword.control.export',
				],
				s.keywordImport,
			),
			token(
				[
					'keyword.operator',
					'keyword.operator.logical',
					'keyword.operator.new',
				],
				s.keywordOperator,
			),
			token(
				[
					'entity.name.function',
					'support.function',
					'meta.function-call.generic',
					'variable.function',
				],
				s.function,
			),
			token(
				['meta.function-call', 'entity.name.function.call'],
				s.functionCall,
			),
			token(
				['entity.name.function.member', 'meta.method-call'],
				s.functionMethodCall,
			),
			token(
				[
					'entity.name.type',
					'entity.name.class',
					'entity.name.namespace',
					'support.type',
					'support.class',
				],
				s.type,
			),
			token(
				['entity.name.function.constructor', 'entity.name.type.class'],
				s.constructor,
			),
			token(
				['variable', 'variable.other', 'meta.definition.variable.name'],
				s.variable,
			),
			token(
				['variable.other.member', 'variable.other.object.property'],
				s.variableMember,
			),
			token(
				[
					'variable.other.property',
					'support.type.property-name',
					'meta.object-literal.key',
					'entity.other.attribute-name',
				],
				s.property,
			),
			token(
				['keyword.operator.assignment', 'keyword.operator.arithmetic'],
				s.operator,
			),
			token(['punctuation'], s.punctuation),
			token(
				['punctuation.definition.block', 'meta.brace', 'punctuation.section'],
				s.punctuationBracket,
			),
			token(
				[
					'punctuation.separator',
					'punctuation.terminator',
					'punctuation.definition.parameters',
				],
				s.punctuationDelimiter,
			),
			token(['entity.name.tag'], s.type),
			token(['invalid', 'invalid.illegal'], c.red),
			token(['markup.heading', 'entity.name.section'], s.markupHeading),
			token(['markup.heading.1'], s.markupHeading1),
			token(['markup.heading.2'], s.markupHeading2),
			{
				scope: ['markup.bold'],
				settings: { foreground: s.markupBold, fontStyle: 'bold' },
			},
			{
				scope: ['markup.italic'],
				settings: { foreground: s.markupItalic, fontStyle: 'italic' },
			},
			token(['markup.list', 'punctuation.definition.list'], s.markupList),
			token(['markup.quote'], s.markupQuote),
			token(['markup.raw', 'markup.inline.raw'], s.markupRaw),
			token(['markup.fenced_code', 'markup.raw.block'], s.markupRawBlock),
			{
				scope: ['markup.underline.link', 'string.other.link'],
				settings: { foreground: s.markupLink, fontStyle: 'underline' },
			},
			token(['markup.inserted'], c.diffAddedSign),
			token(['markup.deleted'], c.diffRemovedSign),
		],
	};
}

/**
 * Registers the Pierre/Shiki theme backing an Otto theme id. Idempotent, so it
 * is safe to call on every render or theme switch.
 */
export function ensurePierreTheme(themeId: ThemeId): string {
	const name = getPierreThemeName(themeId);
	if (registered.has(name)) return name;
	registered.add(name);
	registerCustomTheme(name, () =>
		Promise.resolve(ottoThemeToShikiTheme(getTheme(themeId))),
	);
	return name;
}

export interface PierreThemeSelection {
	/**
	 * Both slots point at the same registered theme: Otto resolves the active
	 * theme itself, so Pierre must not fall back to OS preference.
	 */
	theme: ThemesType;
	themeType: ThemeTypes;
	/** Documented `--diffs-*-override` custom properties for the diff chrome. */
	cssVariables: Record<string, string>;
}

/**
 * Resolves everything Pierre needs to render in the given Otto theme: the
 * registered Shiki theme pair, the explicit light/dark selector, and the
 * diff-chrome color overrides derived from the Otto palette.
 */
export function resolvePierreTheme(themeId: ThemeId): PierreThemeSelection {
	const otto = getTheme(themeId);
	const name = ensurePierreTheme(otto.id);
	const c = otto.colors;

	return {
		theme: { dark: name, light: name },
		themeType: otto.mode,
		cssVariables: {
			// Keep the semantic diff accents consistent with Otto's previous
			// CodeMirror viewer while syntax and surfaces follow the active theme.
			'--diffs-addition-color-override': OTTO_DIFF_ADDITION,
			'--diffs-deletion-color-override': OTTO_DIFF_DELETION,
			'--diffs-modified-color-override': c.blue,
			'--diffs-fg-number-override': c.diffLineNumberFg,
		},
	};
}
