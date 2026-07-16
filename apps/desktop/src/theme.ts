import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
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
	const themeRef = useRef<Theme>('otto-dark');
	const persistedThemeRef = useRef<Theme>('otto-dark');
	const themeChangeVersionRef = useRef(0);
	const themeUpdateQueueRef = useRef(Promise.resolve());

	useEffect(() => {
		if (!serverReady) return;
		let cancelled = false;
		const requestedAtVersion = themeChangeVersionRef.current;

		apiClient
			.getConfig()
			.then((config) => {
				if (cancelled || requestedAtVersion !== themeChangeVersionRef.current) {
					return;
				}
				const configTheme = normalizeThemeId(config.defaults.theme);
				themeRef.current = configTheme;
				persistedThemeRef.current = configTheme;
				setThemeState(configTheme);
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
		if (themeRef.current === nextTheme) return;

		const changeVersion = ++themeChangeVersionRef.current;
		themeRef.current = nextTheme;
		setThemeState(nextTheme);

		// Preserve click order so a slower request cannot persist an older theme last.
		themeUpdateQueueRef.current = themeUpdateQueueRef.current.then(async () => {
			try {
				await apiClient.updateDefaults({ theme: nextTheme });
				persistedThemeRef.current = nextTheme;
			} catch {
				if (changeVersion !== themeChangeVersionRef.current) return;
				themeRef.current = persistedThemeRef.current;
				setThemeState(persistedThemeRef.current);
			}
		});
	}, []);

	const toggleTheme = useCallback(() => {
		setTheme(getOppositeThemeId(themeRef.current));
	}, [setTheme]);

	return { theme, setTheme, toggleTheme };
}
