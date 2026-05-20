import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useConfig, useUpdateDefaults } from './useConfig';
import { notifyPlatformFontFamilyChanged } from '../lib/platform';

interface StoredPreferences {
	vimMode: boolean;
	compactThread: boolean;
	fontFamily: string;
}

interface Preferences extends StoredPreferences {
	fullWidthContent: boolean;
}

const STORAGE_KEY = 'otto-preferences';
const DEFAULT_FONT_FAMILY = 'IBM Plex Mono';
const DEFAULT_STORED_PREFERENCES: StoredPreferences = {
	vimMode: false,
	compactThread: true,
	fontFamily: DEFAULT_FONT_FAMILY,
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

function resolveInitialPreferences(): StoredPreferences {
	if (typeof window === 'undefined') {
		return DEFAULT_STORED_PREFERENCES;
	}
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored) as Partial<StoredPreferences>;
			return {
				vimMode:
					typeof parsed.vimMode === 'boolean'
						? parsed.vimMode
						: DEFAULT_STORED_PREFERENCES.vimMode,
				compactThread:
					typeof parsed.compactThread === 'boolean'
						? parsed.compactThread
						: DEFAULT_STORED_PREFERENCES.compactThread,
				fontFamily:
					typeof parsed.fontFamily === 'string' && parsed.fontFamily.trim()
						? parsed.fontFamily.trim()
						: DEFAULT_STORED_PREFERENCES.fontFamily,
			};
		}
	} catch (error) {
		console.warn('Failed to load preferences', error);
	}
	return DEFAULT_STORED_PREFERENCES;
}

let preferences: StoredPreferences = resolveInitialPreferences();
applyFontFamily(preferences.fontFamily);
const listeners = new Set<() => void>();

function getSnapshot(): StoredPreferences {
	return preferences;
}

function getServerSnapshot(): StoredPreferences {
	return DEFAULT_STORED_PREFERENCES;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function notifyListeners() {
	for (const listener of listeners) {
		listener();
	}
}

function updateStore(updates: Partial<StoredPreferences>) {
	preferences = { ...preferences, ...updates };
	if (updates.fontFamily !== undefined) {
		applyFontFamily(preferences.fontFamily);
	}
	if (typeof window !== 'undefined') {
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
		} catch (error) {
			console.warn('Failed to persist preferences', error);
		}
	}
	notifyListeners();
}

export function usePreferences() {
	const currentPreferences = useSyncExternalStore(
		subscribe,
		getSnapshot,
		getServerSnapshot,
	);
	const { data: config } = useConfig();
	const updateDefaults = useUpdateDefaults();

	const updatePreferences = useCallback(
		(updates: Partial<Preferences>) => {
			const localUpdates: Partial<StoredPreferences> = {};

			if (updates.vimMode !== undefined) {
				localUpdates.vimMode = updates.vimMode;
			}
			if (updates.compactThread !== undefined) {
				localUpdates.compactThread = updates.compactThread;
			}
			if (updates.fontFamily !== undefined) {
				localUpdates.fontFamily =
					updates.fontFamily.trim() || DEFAULT_FONT_FAMILY;
			}

			if (Object.keys(localUpdates).length > 0) {
				updateStore(localUpdates);
			}

			if (
				updates.fullWidthContent !== undefined &&
				updates.fullWidthContent !== config?.defaults?.fullWidthContent
			) {
				updateDefaults.mutate({
					fullWidthContent: updates.fullWidthContent,
					scope: 'global',
				});
			}
		},
		[config?.defaults?.fullWidthContent, updateDefaults],
	);

	const resolvedPreferences = useMemo<Preferences>(
		() => ({
			...currentPreferences,
			fullWidthContent: config?.defaults?.fullWidthContent ?? false,
		}),
		[currentPreferences, config?.defaults?.fullWidthContent],
	);

	return useMemo(
		() => ({ preferences: resolvedPreferences, updatePreferences }),
		[resolvedPreferences, updatePreferences],
	);
}

export type { Preferences };
