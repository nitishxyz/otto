import { getCurrentWindow } from '@tauri-apps/api/window';
import { onAction } from '@tauri-apps/plugin-notification';
import {
	isPermissionGranted,
	requestPermission,
	sendNotification,
} from '@tauri-apps/plugin-notification';
import { openUrl } from '@tauri-apps/plugin-opener';
import { configureApiClient } from '@ottocode/web-sdk/lib';
import { tauriBridge } from './tauri-bridge';

interface OttoWindow extends Window {
	OTTO_SERVER_URL?: string;
	OTTO_OPEN_URL?: (url: string) => void | Promise<void>;
	OTTO_SHOW_NOTIFICATION?: (
		notification: OttoPlatformNotification,
	) => void | Promise<void>;
	OTTO_LIST_SYSTEM_FONTS?: () => Promise<string[]>;
	OTTO_SET_DESKTOP_FONT?: (fontFamily: string) => void | Promise<void>;
	OTTO_OPEN_SESSION?: (sessionId: string) => void | Promise<void>;
	OTTO_NOTIFICATION_ACTION_LISTENER?: boolean;
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
let hasRequestedNotificationPermission = false;
let isDesktopWindowFocused = document.hasFocus();

function notificationIdFromString(id: string) {
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = (hash * 31 + id.charCodeAt(i)) | 0;
	}
	return Math.abs(hash || Date.now()) % 2_147_483_647;
}

async function ensureNotificationPermission() {
	if (await isPermissionGranted()) return true;
	if (hasRequestedNotificationPermission) return false;

	hasRequestedNotificationPermission = true;
	const permission = await requestPermission();
	return permission === 'granted' || (await isPermissionGranted());
}

async function showNativeNotification(notification: OttoPlatformNotification) {
	if (!notification.title) return;

	const permissionGranted = await ensureNotificationPermission();
	if (!permissionGranted) {
		return;
	}

	const appWindow = getCurrentWindow();
	sendNotification({
		id: notificationIdFromString(notification.id),
		title: notification.title,
		body: notification.body,
		autoCancel: true,
		sound: 'Ping',
		extra: notification.sessionId
			? { sessionId: notification.sessionId, windowLabel: appWindow.label }
			: undefined,
	});
}

function cssFontFamily(fontFamily: string) {
	const trimmed = fontFamily.trim() || DEFAULT_FONT_FAMILY;
	return `"${trimmed.replace(/"/g, '\\"')}", "${DEFAULT_FONT_FAMILY}", monospace`;
}

function registerDesktopPlatformAdapters() {
	const win = window as OttoWindow;
	const appWindow = getCurrentWindow();
	win.OTTO_OPEN_URL = (url) => openUrl(url);
	win.OTTO_SHOW_NOTIFICATION = (notification) =>
		showNativeNotification(notification);
	win.OTTO_IS_WINDOW_FOCUSED = () => isDesktopWindowFocused;
	win.OTTO_LIST_SYSTEM_FONTS = () => tauriBridge.listSystemFonts();
	win.OTTO_SET_DESKTOP_FONT = (fontFamily) => {
		document.documentElement.style.setProperty(
			'--otto-font-family',
			cssFontFamily(fontFamily),
		);
		window.localStorage.setItem('otto-desktop-font-family', fontFamily);
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

	if (!win.OTTO_NOTIFICATION_ACTION_LISTENER) {
		win.OTTO_NOTIFICATION_ACTION_LISTENER = true;
		const currentWindowLabel = appWindow.label;
		onAction((notification) => {
			const notificationWindowLabel =
				typeof notification.extra?.windowLabel === 'string'
					? notification.extra.windowLabel
					: undefined;
			if (
				notificationWindowLabel &&
				notificationWindowLabel !== currentWindowLabel
			) {
				return;
			}

			const sessionId =
				typeof notification.extra?.sessionId === 'string'
					? notification.extra.sessionId
					: undefined;
			if (sessionId) {
				void win.OTTO_OPEN_SESSION?.(sessionId);
			}
		}).catch((error: unknown) => {
			console.error('[otto] Failed to register notification actions:', error);
		});
	}
}

export function configureDesktopSdk(apiUrl: string) {
	const win = window as OttoWindow;
	win.OTTO_SERVER_URL = apiUrl;
	registerDesktopPlatformAdapters();
	configureApiClient();
}
