import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConfig, useUpdateDefaults } from './useConfig';

type Theme = 'light' | 'dark';

function normalizeTheme(theme: string | undefined): Theme {
	return theme === 'light' ? 'light' : 'dark';
}

export function useTheme() {
	const { data: config } = useConfig();
	const updateDefaults = useUpdateDefaults();
	const configTheme = normalizeTheme(config?.defaults?.theme);
	const [optimisticTheme, setOptimisticTheme] = useState<Theme | null>(null);
	const theme = optimisticTheme ?? configTheme;

	useEffect(() => {
		if (optimisticTheme === configTheme) {
			setOptimisticTheme(null);
		}
	}, [configTheme, optimisticTheme]);

	useEffect(() => {
		if (typeof document === 'undefined') return;

		const root = document.documentElement;
		if (theme === 'dark') {
			root.classList.add('dark');
		} else {
			root.classList.remove('dark');
		}

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
		setTheme(theme === 'dark' ? 'light' : 'dark');
	}, [setTheme, theme]);

	return useMemo(
		() => ({ theme, setTheme, toggleTheme }),
		[theme, setTheme, toggleTheme],
	);
}

export type { Theme };
