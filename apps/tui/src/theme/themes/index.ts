import {
	themeList as sharedThemeList,
	themes as sharedThemes,
	themeToTuiTheme,
} from '@ottocode/themes';
import type { Theme } from '../types.ts';

export const themes: Record<string, Theme> = Object.fromEntries(
	Object.values(sharedThemes).map((theme) => [
		theme.id,
		themeToTuiTheme(theme),
	]),
);

export const themeList: Theme[] = sharedThemeList.map(themeToTuiTheme);

export { DEFAULT_THEME } from '@ottocode/themes';
