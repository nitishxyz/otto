import { useCallback, useEffect, useMemo } from 'react';
import {
	applyCssTheme,
	getOppositeThemeId,
	normalizeThemeId,
	type ThemeId,
} from '@ottocode/themes';
import { useConfig, useUpdateDefaults } from './useConfig';

type Theme = ThemeId;

export function useTheme(options?: { enabled?: boolean }) {
	const { data: config } = useConfig(options);
	const updateDefaults = useUpdateDefaults();
	// null until the config query resolves; applying a fallback theme before
	// then clobbers the theme already on the document (set by the desktop
	// shell or a previous page) and causes a visible flicker on mount.
	const theme = config ? normalizeThemeId(config.defaults?.theme) : null;

	useEffect(() => {
		if (theme === null || typeof document === 'undefined') return;

		applyCssTheme(theme);

		if (window.parent && window.parent !== window) {
			window.parent.postMessage({ type: 'otto-set-theme', theme }, '*');
		}
	}, [theme]);

	const setTheme = useCallback(
		(nextTheme: Theme) => {
			updateDefaults.mutate({ theme: nextTheme, scope: 'global' });
		},
		[updateDefaults],
	);

	const toggleTheme = useCallback(() => {
		if (theme === null) return;
		setTheme(getOppositeThemeId(theme));
	}, [setTheme, theme]);

	return useMemo(
		() => ({ theme, setTheme, toggleTheme }),
		[theme, setTheme, toggleTheme],
	);
}

export type { Theme };
