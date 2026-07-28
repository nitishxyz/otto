/**
 * Shared tokens for the docs diagram/callout kit.
 *
 * Accents resolve through the same `--np-*` variables the homepage NeoPop
 * primitives use, so docs visuals stay in sync with both themes.
 */
export type DocAccent = 'blue' | 'lime' | 'yellow' | 'coral' | 'neutral';

export const ACCENT_FILL: Record<DocAccent, string> = {
	blue: 'bg-np-blue',
	lime: 'bg-np-lime',
	yellow: 'bg-np-yellow',
	coral: 'bg-np-coral',
	neutral: 'bg-otto-border',
};

export const ACCENT_ON: Record<DocAccent, string> = {
	blue: 'bg-np-blue text-np-blue-on',
	lime: 'bg-np-lime text-np-lime-on',
	yellow: 'bg-np-yellow text-np-yellow-on',
	coral: 'bg-np-coral text-np-coral-on',
	neutral: 'bg-otto-card text-otto-text',
};

export const ACCENT_TEXT: Record<DocAccent, string> = {
	blue: 'text-np-blue',
	lime: 'text-np-lime',
	yellow: 'text-np-yellow',
	coral: 'text-np-coral',
	neutral: 'text-otto-dim',
};

export const ACCENT_EDGE: Record<DocAccent, string> = {
	blue: '[border-left-color:rgb(var(--np-blue))]',
	lime: '[border-left-color:rgb(var(--np-lime))]',
	yellow: '[border-left-color:rgb(var(--np-yellow))]',
	coral: '[border-left-color:rgb(var(--np-coral))]',
	neutral: '[border-left-color:rgb(var(--otto-border))]',
};

/** `.prose-otto` re-adds list padding/margins, so kit lists opt out loudly. */
export const RESET_LIST = 'list-none !pl-0 !my-0';
export const RESET_TEXT = '!m-0';
