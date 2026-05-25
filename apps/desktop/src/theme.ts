import { createContext, useContext } from 'react';
import type { Theme } from '@ottocode/web-sdk/hooks';

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
