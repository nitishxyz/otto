import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
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
	const pendingThemeRef = useRef<Theme | null>(null);
	const [theme, setThemeState] = useState<Theme>(() =>
		normalizeThemeId(
			typeof document === 'undefined'
				? undefined
				: document.documentElement.dataset.theme,
		),
	);

	useLayoutEffect(() => {
		if (
			configTheme !== null &&
			(!updateDefaults.isPending || pendingThemeRef.current === configTheme)
		) {
			setThemeState(configTheme);
		}
	}, [configTheme, updateDefaults.isPending]);

	useEffect(
		() =>
			onDefaultsChange((defaults) => {
				if (typeof defaults.theme !== 'string') return;
				const nextTheme = normalizeThemeId(defaults.theme);
				if (
					pendingThemeRef.current !== null &&
					pendingThemeRef.current !== nextTheme
				) {
					return;
				}
				setThemeState(nextTheme);
			}),
		[],
	);

	useLayoutEffect(() => {
		applyCssTheme(theme);
	}, [theme]);

	const setTheme = useCallback(
		(nextTheme: Theme) => {
			const previousTheme = theme;
			pendingThemeRef.current = nextTheme;
			setThemeState(nextTheme);
			updateDefaults.mutate(
				{ theme: nextTheme, scope: 'global' },
				{
					onError: () => {
						if (pendingThemeRef.current !== nextTheme) return;
						pendingThemeRef.current = null;
						setThemeState(previousTheme);
					},
					onSettled: () => {
						if (pendingThemeRef.current === nextTheme) {
							pendingThemeRef.current = null;
						}
					},
				},
			);
		},
		[theme, updateDefaults],
	);

	const toggleTheme = useCallback(() => {
		setTheme(getOppositeThemeId(theme));
	}, [setTheme, theme]);

	return { theme, setTheme, toggleTheme };
}
