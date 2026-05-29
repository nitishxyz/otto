import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from 'react';
import type { Theme } from '@ottocode/web-sdk/hooks';
import { tauriOnboarding } from './lib/tauri-onboarding';

export interface DesktopThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	toggleTheme: () => void;
}

export const DesktopThemeContext = createContext<DesktopThemeContextValue>({
	theme: 'dark',
	setTheme: () => {},
	toggleTheme: () => {},
});

export const useDesktopTheme = () => useContext(DesktopThemeContext);

function normalizeTheme(theme: string | undefined): Theme {
	return theme === 'light' ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
	if (typeof document === 'undefined') return;

	const root = document.documentElement;
	if (theme === 'dark') {
		root.classList.add('dark');
	} else {
		root.classList.remove('dark');
	}
}

function getOppositeTheme(theme: Theme): Theme {
	return theme === 'dark' ? 'light' : 'dark';
}

export function useNativeDesktopTheme(): DesktopThemeContextValue {
	const [theme, setThemeState] = useState<Theme>('dark');

	useEffect(() => {
		let cancelled = false;

		tauriOnboarding
			.getStatus()
			.then((status) => {
				if (cancelled) return;
				setThemeState(normalizeTheme(status.defaults.theme));
			})
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);

	const setTheme = useCallback((nextTheme: Theme) => {
		let previousTheme: Theme | null = null;
		setThemeState((currentTheme) => {
			previousTheme = currentTheme;
			return nextTheme;
		});
		tauriOnboarding.setDefaults({ theme: nextTheme }).catch(() => {
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
			const nextTheme = getOppositeTheme(currentTheme);
			tauriOnboarding.setDefaults({ theme: nextTheme }).catch(() => {
				setThemeState((latestTheme) =>
					latestTheme === nextTheme ? currentTheme : latestTheme,
				);
			});
			return nextTheme;
		});
	}, []);

	return { theme, setTheme, toggleTheme };
}
