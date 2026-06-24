import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	applyCssTheme,
	getOppositeThemeId,
	normalizeThemeId,
	type ThemeId,
} from '@ottocode/themes';
import { useConfig, useUpdateDefaults } from './useConfig';

type Theme = ThemeId;

export function useTheme() {
	const { data: config } = useConfig();
	const updateDefaults = useUpdateDefaults();
	const configTheme = normalizeThemeId(config?.defaults?.theme);
	const [optimisticTheme, setOptimisticTheme] = useState<Theme | null>(null);
	const theme = optimisticTheme ?? configTheme;

	useEffect(() => {
		if (optimisticTheme === configTheme) {
			setOptimisticTheme(null);
		}
	}, [configTheme, optimisticTheme]);

	useEffect(() => {
		if (typeof document === 'undefined') return;

		applyCssTheme(theme);

		if (window.parent && window.parent !== window) {
			window.parent.postMessage({ type: 'otto-set-theme', theme }, '*');
		}
	}, [theme]);

	const setTheme = useCallback(
		(nextTheme: Theme) => {
			setOptimisticTheme(nextTheme);
			updateDefaults.mutate(
				{ theme: nextTheme, scope: 'global' },
				{
					onError: () => {
						setOptimisticTheme((currentTheme) =>
							currentTheme === nextTheme ? null : currentTheme,
						);
					},
				},
			);
		},
		[updateDefaults],
	);

	const toggleTheme = useCallback(() => {
		setTheme(getOppositeThemeId(theme));
	}, [setTheme, theme]);

	return useMemo(
		() => ({ theme, setTheme, toggleTheme }),
		[theme, setTheme, toggleTheme],
	);
}

export type { Theme };
