import type { OttoTheme } from '../types';
import { ayuDark, ayuLight, ayuMirage } from './ayu';
import { catppuccinMocha } from './catppuccin';
import { dracula } from './dracula';
import { gruvbox } from './gruvbox';
import { monokai } from './monokai';
import { nord } from './nord';
import { ottoDark, ottoLight } from './otto';
import { rosePine, rosePineDawn, rosePineMoon } from './rose-pine';
import { solarizedDark } from './solarized';
import { tokyoNight } from './tokyo-night';

export {
	ayuDark,
	ayuLight,
	ayuMirage,
	catppuccinMocha,
	dracula,
	gruvbox,
	monokai,
	nord,
	ottoDark,
	ottoLight,
	rosePine,
	rosePineDawn,
	rosePineMoon,
	solarizedDark,
	tokyoNight,
};

/** Every theme definition, in registry/display order. */
export const allThemes: OttoTheme[] = [
	ottoDark,
	ottoLight,
	rosePine,
	rosePineMoon,
	rosePineDawn,
	ayuDark,
	ayuMirage,
	ayuLight,
	tokyoNight,
	catppuccinMocha,
	nord,
	gruvbox,
	monokai,
	dracula,
	solarizedDark,
];
