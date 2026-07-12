import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from 'react';
import {
	applyCssTheme,
	getOppositeThemeId,
	normalizeThemeId,
	type ThemeId,
} from '@ottocode/themes';
import { apiClient } from '@ottocode/web-sdk/lib';

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
	const [theme, setThemeState] = useState<Theme>('otto-dark');

	useEffect(() => {
		if (!serverReady) return;
		let cancelled = false;

		apiClient
			.getConfig()
			.then((config) => {
				if (cancelled) return;
				setThemeState(normalizeThemeId(config.defaults.theme));
			})
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	}, [serverReady]);

	useEffect(() => {
		applyCssTheme(theme);
	}, [theme]);

	const setTheme = useCallback((nextTheme: Theme) => {
		let previousTheme: Theme | null = null;
		setThemeState((currentTheme) => {
			previousTheme = currentTheme;
			return nextTheme;
		});
		apiClient.updateDefaults({ theme: nextTheme }).catch(() => {
			setThemeState((currentTheme) => {
				if (currentTheme === nextTheme && previousTheme) {
					return previousTheme;
				}
				return currentTheme;
			});
		});
	}, []);

	const toggleTheme = useCallback(() => {
		setThemeState((currentTheme) => {
			const nextTheme = getOppositeThemeId(currentTheme);
			apiClient.updateDefaults({ theme: nextTheme }).catch(() => {
				setThemeState((latestTheme) =>
					latestTheme === nextTheme ? currentTheme : latestTheme,
				);
			});
			return nextTheme;
		});
	}, []);

	return { theme, setTheme, toggleTheme };
}
