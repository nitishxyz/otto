import { useCallback, useEffect, useMemo } from 'react';
import { useConfig, useUpdateDefaults } from './useConfig';
import { notifyPlatformFontFamilyChanged } from '../lib/platform';

interface Preferences {
	vimMode: boolean;
	compactThread: boolean;
	fontFamily: string;
	smartEdges: boolean;
	releaseToSend: boolean;
	fullWidthContent: boolean;
}

const DEFAULT_FONT_FAMILY = 'IBM Plex Mono';
const DEFAULT_PREFERENCES: Preferences = {
	vimMode: false,
	compactThread: true,
	fontFamily: DEFAULT_FONT_FAMILY,
	smartEdges: true,
	releaseToSend: false,
	fullWidthContent: false,
};

function cssFontFamily(fontFamily: string): string {
	const trimmed = fontFamily.trim();
	if (!trimmed || trimmed === DEFAULT_FONT_FAMILY) {
		return `"${DEFAULT_FONT_FAMILY}", monospace`;
	}
	return `"${trimmed.replaceAll('"', '\\"')}", "${DEFAULT_FONT_FAMILY}", monospace`;
}

function applyFontFamily(fontFamily: string) {
	if (typeof document === 'undefined') {
		return;
	}
	document.documentElement.style.setProperty(
		'--otto-font-family',
		cssFontFamily(fontFamily),
	);
	document.documentElement.dataset.ottoFontFamily = fontFamily;
	if (notifyPlatformFontFamilyChanged(fontFamily)) {
		return;
	}
	if (window.self !== window.top) {
		window.parent.postMessage(
			{ type: 'otto-font-family-changed', fontFamily },
			'*',
		);
	}
}

export function usePreferences() {
	const { data: config } = useConfig();
	const updateDefaults = useUpdateDefaults();

	const resolvedPreferences = useMemo<Preferences>(
		() => ({
			vimMode: config?.defaults?.vimMode ?? DEFAULT_PREFERENCES.vimMode,
			compactThread:
				config?.defaults?.compactThread ?? DEFAULT_PREFERENCES.compactThread,
			fontFamily:
				config?.defaults?.fontFamily?.trim() || DEFAULT_PREFERENCES.fontFamily,
			smartEdges:
				config?.defaults?.smartEdges ?? DEFAULT_PREFERENCES.smartEdges,
			releaseToSend:
				config?.defaults?.releaseToSend ?? DEFAULT_PREFERENCES.releaseToSend,
			fullWidthContent:
				config?.defaults?.fullWidthContent ??
				DEFAULT_PREFERENCES.fullWidthContent,
		}),
		[
			config?.defaults?.vimMode,
			config?.defaults?.compactThread,
			config?.defaults?.fontFamily,
			config?.defaults?.smartEdges,
			config?.defaults?.releaseToSend,
			config?.defaults?.fullWidthContent,
		],
	);

	useEffect(() => {
		applyFontFamily(resolvedPreferences.fontFamily);
	}, [resolvedPreferences.fontFamily]);

	const updatePreferences = useCallback(
		(updates: Partial<Preferences>) => {
			const nextUpdates: Partial<Preferences> = {};

			if (updates.vimMode !== undefined) {
				nextUpdates.vimMode = updates.vimMode;
			}
			if (updates.compactThread !== undefined) {
				nextUpdates.compactThread = updates.compactThread;
			}
			if (updates.fontFamily !== undefined) {
				nextUpdates.fontFamily =
					updates.fontFamily.trim() || DEFAULT_FONT_FAMILY;
			}
			if (updates.smartEdges !== undefined) {
				nextUpdates.smartEdges = updates.smartEdges;
			}
			if (updates.releaseToSend !== undefined) {
				nextUpdates.releaseToSend = updates.releaseToSend;
			}
			if (updates.fullWidthContent !== undefined) {
				nextUpdates.fullWidthContent = updates.fullWidthContent;
			}

			if (Object.keys(nextUpdates).length === 0) {
				return;
			}

			updateDefaults.mutate({ ...nextUpdates, scope: 'global' });
		},
		[updateDefaults],
	);

	return useMemo(
		() => ({ preferences: resolvedPreferences, updatePreferences }),
		[resolvedPreferences, updatePreferences],
	);
}

export type { Preferences };
