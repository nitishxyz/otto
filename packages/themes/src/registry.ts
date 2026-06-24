import { allThemes } from './themes';
import { type OttoTheme, type ThemeId, themeIds } from './types';

export const themes = Object.fromEntries(
	allThemes.map((theme) => [theme.id, theme]),
) as Record<ThemeId, OttoTheme>;

export const DEFAULT_THEME: ThemeId = 'otto-dark';
export const themeList: OttoTheme[] = themeIds.map((id) => themes[id]);

export function isThemeId(value: string | undefined): value is ThemeId {
	return !!value && value in themes;
}

export function normalizeThemeId(value: string | undefined): ThemeId {
	if (value === 'dark') return 'otto-dark';
	if (value === 'light') return 'otto-light';
	return isThemeId(value) ? value : DEFAULT_THEME;
}

export function getTheme(value: string | undefined): OttoTheme {
	return themes[normalizeThemeId(value)];
}

export function getOppositeThemeId(themeId: string | undefined): ThemeId {
	const theme = getTheme(themeId);
	if (theme.id === 'otto-dark') return 'otto-light';
	if (theme.id === 'otto-light') return 'otto-dark';
	return theme.mode === 'dark' ? 'otto-light' : 'otto-dark';
}
