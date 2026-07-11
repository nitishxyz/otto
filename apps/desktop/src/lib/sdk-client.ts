import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
	activateShareMode,
	clearShareMode,
	configureApiClient,
} from '@ottocode/web-sdk/lib';
import { registerNativeBrowserBridge } from './native-browser';
import { normalizeDesktopRemoteUrl } from './remote-url';
import { tauriBridge, type ServerInfo } from './tauri-bridge';

interface OttoWindow extends Window {
	OTTO_SERVER_URL?: string;
	OTTO_RUNTIME_CONTEXT?: {
		projectId?: string;
		projectRoot?: string;
		serverToken?: string;
		ownerSession?: { token: string; expiresAt?: number };
	};
	OTTO_OPEN_URL?: (url: string) => void | Promise<void>;
	OTTO_SHOW_NOTIFICATION?: (
		notification: OttoPlatformNotification,
	) => void | Promise<void>;
	OTTO_LIST_SYSTEM_FONTS?: () => Promise<string[]>;
	OTTO_SET_DESKTOP_FONT?: (fontFamily: string) => void | Promise<void>;
	OTTO_OPEN_SESSION?: (sessionId: string) => void | Promise<void>;
	OTTO_VOICE_SHORTCUT_LISTENER?: boolean;
	OTTO_WINDOW_FOCUS_LISTENER?: boolean;
	OTTO_IS_WINDOW_FOCUSED?: () => boolean;
}

interface OttoPlatformNotification {
	id: string;
	title: string;
	body?: string;
	sessionId?: string;
}

const DEFAULT_FONT_FAMILY = 'IBM Plex Mono';
let isDesktopWindowFocused = document.hasFocus();
let ownsVoiceShortcutPress = false;

async function showNativeNotification(notification: OttoPlatformNotification) {
	if (!notification.title) return;

	await tauriBridge.showNativeNotification({
		title: notification.title,
		body: notification.body,
		sessionId: notification.sessionId,
	});
}

function cssFontFamily(fontFamily: string) {
	const trimmed = fontFamily.trim() || DEFAULT_FONT_FAMILY;
	return `"${trimmed.replace(/"/g, '\\"')}", "${DEFAULT_FONT_FAMILY}", monospace`;
}

function dispatchVoiceShortcutEvent(eventName: string) {
	window.dispatchEvent(new CustomEvent(eventName));
}

function isCurrentWindowFocused() {
	return isDesktopWindowFocused || document.hasFocus();
}

function registerDesktopPlatformAdapters() {
	const win = window as OttoWindow;
	const appWindow = getCurrentWindow();
	win.OTTO_OPEN_URL = (url) => openUrl(url);
	registerNativeBrowserBridge();
	win.OTTO_SHOW_NOTIFICATION = (notification) =>
		showNativeNotification(notification);
	win.OTTO_IS_WINDOW_FOCUSED = () => isDesktopWindowFocused;
	win.OTTO_LIST_SYSTEM_FONTS = () => tauriBridge.listSystemFonts();
	win.OTTO_SET_DESKTOP_FONT = (fontFamily) => {
		document.documentElement.style.setProperty(
			'--otto-font-family',
			cssFontFamily(fontFamily),
		);
	};
	void appWindow
		.isFocused()
		.then((focused) => {
			isDesktopWindowFocused = focused;
		})
		.catch(() => {});

	if (!win.OTTO_WINDOW_FOCUS_LISTENER) {
		win.OTTO_WINDOW_FOCUS_LISTENER = true;
		void appWindow
			.onFocusChanged(({ payload }) => {
				isDesktopWindowFocused = payload;
			})
			.catch((error: unknown) => {
				console.error('[otto] Failed to register focus listener:', error);
			});
	}

	if (!win.OTTO_VOICE_SHORTCUT_LISTENER) {
		win.OTTO_VOICE_SHORTCUT_LISTENER = true;
		void listen('otto:voice-shortcut-down', () => {
			if (!isCurrentWindowFocused()) return;
			ownsVoiceShortcutPress = true;
			dispatchVoiceShortcutEvent('otto:voice-shortcut-down');
		}).catch((error: unknown) => {
			console.error('[otto] Failed to register voice shortcut down:', error);
		});
		void listen('otto:voice-shortcut-up', () => {
			if (!ownsVoiceShortcutPress) return;
			ownsVoiceShortcutPress = false;
			dispatchVoiceShortcutEvent('otto:voice-shortcut-up');
		}).catch((error: unknown) => {
			console.error('[otto] Failed to register voice shortcut up:', error);
		});
	}
}

export function configureDesktopSdk(
	apiUrl: string,
	server?: ServerInfo | null,
) {
	const win = window as OttoWindow;
	if (server) {
		clearShareMode();
		win.OTTO_SERVER_URL = apiUrl;
		win.OTTO_RUNTIME_CONTEXT = {
			projectId: server.projectId,
			projectRoot: server.projectPath,
			serverToken: server.token ?? undefined,
		};
	} else {
		const remote = normalizeDesktopRemoteUrl(apiUrl);
		win.OTTO_SERVER_URL = remote.apiUrl;
		delete win.OTTO_RUNTIME_CONTEXT;
		if (remote.shareToken) activateShareMode(remote.shareToken);
		else clearShareMode();
	}
	registerDesktopPlatformAdapters();
	configureApiClient();
}

export function configureMachineSdk(
	apiUrl: string,
	projectId: string,
	projectRoot: string,
	ownerSession: string,
	ownerSessionExpiresAt: number,
) {
	const win = window as OttoWindow;
	clearShareMode();
	win.OTTO_SERVER_URL = apiUrl;
	win.OTTO_RUNTIME_CONTEXT = {
		projectId,
		projectRoot,
		ownerSession: { token: ownerSession, expiresAt: ownerSessionExpiresAt },
	};
	registerDesktopPlatformAdapters();
	configureApiClient();
}
