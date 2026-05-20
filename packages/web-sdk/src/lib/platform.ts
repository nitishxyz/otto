export interface OttoPlatformNotification {
	id: string;
	title: string;
	body?: string;
	sessionId?: string;
}

interface OttoPlatformWindow extends Window {
	OTTO_OPEN_URL?: (url: string) => void | Promise<void>;
	OTTO_SHOW_NOTIFICATION?: (
		notification: OttoPlatformNotification,
	) => void | Promise<void>;
	OTTO_LIST_SYSTEM_FONTS?: () => Promise<string[]>;
	OTTO_SET_DESKTOP_FONT?: (fontFamily: string) => void | Promise<void>;
	OTTO_OPEN_SESSION?: (sessionId: string) => void | Promise<void>;
}

function getPlatformWindow(): OttoPlatformWindow | null {
	if (typeof window === 'undefined') return null;
	return window as OttoPlatformWindow;
}

export function openPlatformUrl(url: string): boolean {
	const win = getPlatformWindow();
	if (!win?.OTTO_OPEN_URL) return false;
	void win.OTTO_OPEN_URL(url);
	return true;
}

export function showPlatformNotification(
	notification: OttoPlatformNotification,
): boolean {
	const win = getPlatformWindow();
	if (!win?.OTTO_SHOW_NOTIFICATION) return false;
	void win.OTTO_SHOW_NOTIFICATION(notification);
	return true;
}

export function listPlatformSystemFonts(): Promise<string[]> | null {
	const win = getPlatformWindow();
	if (!win?.OTTO_LIST_SYSTEM_FONTS) return null;
	return win.OTTO_LIST_SYSTEM_FONTS();
}

export function notifyPlatformFontFamilyChanged(fontFamily: string): boolean {
	const win = getPlatformWindow();
	if (!win?.OTTO_SET_DESKTOP_FONT) return false;
	void win.OTTO_SET_DESKTOP_FONT(fontFamily);
	return true;
}

export function openPlatformSession(sessionId: string): boolean {
	const win = getPlatformWindow();
	if (!win?.OTTO_OPEN_SESSION) return false;
	void win.OTTO_OPEN_SESSION(sessionId);
	return true;
}

export function hasPlatformOpenUrl(): boolean {
	return !!getPlatformWindow()?.OTTO_OPEN_URL;
}

export function hasPlatformSystemFonts(): boolean {
	return !!getPlatformWindow()?.OTTO_LIST_SYSTEM_FONTS;
}
