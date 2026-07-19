import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useState,
} from 'react';
import {
	applyCssTheme,
	getOppositeThemeId,
	normalizeThemeId,
	type ThemeId,
} from '@ottocode/themes';
import { useConfig, useUpdateDefaults } from '@ottocode/web-sdk/hooks';
import { onDefaultsChange } from '@ottocode/web-sdk/lib';

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
	const configTheme = config ? normalizeThemeId(config.defaults.theme) : null;
	const [theme, setThemeState] = useState<Theme>(() =>
		normalizeThemeId(
			typeof document === 'undefined'
				? undefined
				: document.documentElement.dataset.theme,
		),
	);

	useLayoutEffect(() => {
		if (configTheme !== null) setThemeState(configTheme);
	}, [configTheme]);

	useEffect(
		() =>
			onDefaultsChange((defaults) => {
				if (typeof defaults.theme !== 'string') return;
				setThemeState(normalizeThemeId(defaults.theme));
			}),
		[],
	);

	useLayoutEffect(() => {
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
