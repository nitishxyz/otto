import { createContext, useCallback, useContext, useEffect } from 'react';
import {
	applyCssTheme,
	getOppositeThemeId,
	normalizeThemeId,
	type ThemeId,
} from '@ottocode/themes';
import { useConfig, useUpdateDefaults } from '@ottocode/web-sdk/hooks';

type Theme = ThemeId;

export interface DesktopThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	toggleTheme: () => void;
}

export const DesktopThemeContext = createContext<DesktopThemeContextValue>({
	theme: 'otto-dark',
	setTheme: () => {},
	toggleTheme: () => {},
});

export const useDesktopTheme = () => useContext(DesktopThemeContext);

export function useNativeDesktopTheme(
	serverReady: boolean,
): DesktopThemeContextValue {
	const { data: config } = useConfig({ enabled: serverReady });
	const updateDefaults = useUpdateDefaults();
	const theme = normalizeThemeId(config?.defaults.theme);

	useEffect(() => {
		applyCssTheme(theme);
	}, [theme]);

	const setTheme = useCallback(
		(nextTheme: Theme) => {
			updateDefaults.mutate({ theme: nextTheme, scope: 'global' });
		},
		[updateDefaults],
	);

	const toggleTheme = useCallback(() => {
		setTheme(getOppositeThemeId(theme));
	}, [setTheme, theme]);

	return { theme, setTheme, toggleTheme };
}
