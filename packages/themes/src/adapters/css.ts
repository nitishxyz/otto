import { hexToHslTriplet, mix } from '../color';
import { getTheme } from '../registry';
import type { OttoTheme, ThemeId } from '../types';

interface DocumentLike {
	documentElement: {
		dataset: Record<string, string>;
		classList: { toggle: (name: string, force?: boolean) => void };
		style: {
			colorScheme: string;
			setProperty: (name: string, value: string) => void;
		};
	};
}

/**
 * Resolves the CSS custom properties for a theme. Themes may carry exact
 * {@link OttoTheme.cssVariables} overrides; otherwise the variables are derived
 * from the shared palette.
 */
export function themeToCssVariables(theme: OttoTheme): Record<string, string> {
	if (theme.cssVariables) return theme.cssVariables;

	const c = theme.colors;
	const code = theme.syntax;
	const border = mix(c.bg, c.fg, theme.mode === 'dark' ? 0.14 : 0.18);
	const input = mix(c.bg, c.fg, theme.mode === 'dark' ? 0.18 : 0.22);
	const sidebarBorder = mix(
		c.bgDark,
		c.fg,
		theme.mode === 'dark' ? 0.12 : 0.16,
	);
	const primaryForeground = theme.mode === 'dark' ? c.bg : c.bgHighlight;
	return {
		'--background': hexToHslTriplet(c.bg),
		'--foreground': hexToHslTriplet(c.fg),
		'--card': hexToHslTriplet(c.bgDark),
		'--card-foreground': hexToHslTriplet(c.fg),
		'--popover': hexToHslTriplet(c.bgDark),
		'--popover-foreground': hexToHslTriplet(c.fg),
		'--primary': hexToHslTriplet(c.fgBright),
		'--primary-foreground': hexToHslTriplet(primaryForeground),
		'--secondary': hexToHslTriplet(c.bgHighlight),
		'--secondary-foreground': hexToHslTriplet(c.fg),
		'--muted': hexToHslTriplet(c.bgHighlight),
		'--muted-foreground': hexToHslTriplet(c.fgMuted),
		'--accent': hexToHslTriplet(c.bgHighlight),
		'--accent-foreground': hexToHslTriplet(c.fgBright),
		'--destructive': hexToHslTriplet(c.red),
		'--destructive-foreground': hexToHslTriplet(c.fgBright),
		'--border': hexToHslTriplet(border),
		'--input': hexToHslTriplet(input),
		'--ring': hexToHslTriplet(c.blue),
		'--chart-1': hexToHslTriplet(c.blue),
		'--chart-2': hexToHslTriplet(c.green),
		'--chart-3': hexToHslTriplet(c.yellow),
		'--chart-4': hexToHslTriplet(c.purple),
		'--chart-5': hexToHslTriplet(c.magenta),
		'--sidebar-background': hexToHslTriplet(c.bgDark),
		'--sidebar-foreground': hexToHslTriplet(c.fg),
		'--sidebar-primary': hexToHslTriplet(c.fgBright),
		'--sidebar-primary-foreground': hexToHslTriplet(c.bgDark),
		'--sidebar-accent': hexToHslTriplet(c.bgHighlight),
		'--sidebar-accent-foreground': hexToHslTriplet(c.fgBright),
		'--sidebar-border': hexToHslTriplet(sidebarBorder),
		'--sidebar-ring': hexToHslTriplet(c.blue),
		'--sidebar-muted-foreground': hexToHslTriplet(c.fgMuted),
		'--code-background': c.bgDark,
		'--code-foreground': c.fg,
		'--code-keyword': code.keyword,
		'--code-class': code.type,
		'--code-function': code.function,
		'--code-string': code.string,
		'--code-comment': code.comment,
		'--code-operator': code.operator,
		'--code-punctuation': code.punctuation,
	};
}

/**
 * Applies a theme to the document root: sets `data-theme`, toggles the `dark`
 * class (for Tailwind `dark:` variants), updates `color-scheme`, and writes the
 * CSS custom properties. No-ops outside the browser. Returns the resolved id.
 */
export function applyCssTheme(themeId: string | undefined): ThemeId {
	const theme = getTheme(themeId);
	const doc = (globalThis as { document?: DocumentLike }).document;
	if (!doc) return theme.id;

	const root = doc.documentElement;
	root.dataset.theme = theme.id;
	root.classList.toggle('dark', theme.mode === 'dark');
	root.style.colorScheme = theme.mode;

	for (const [name, value] of Object.entries(themeToCssVariables(theme))) {
		root.style.setProperty(name, value);
	}

	return theme.id;
}
