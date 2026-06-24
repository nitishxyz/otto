import { getTheme } from '../registry';
import type { OttoTheme, TuiTheme } from '../types';

export function themeToTuiTheme(theme: OttoTheme): TuiTheme {
	return {
		name: theme.id,
		displayName: theme.displayName,
		colors: theme.colors,
		syntax: theme.syntax,
	};
}

export function getTuiTheme(value: string | undefined): TuiTheme {
	return themeToTuiTheme(getTheme(value));
}
