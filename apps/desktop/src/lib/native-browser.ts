import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export interface NativeBrowserBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface NativeBrowserBridge {
	isAvailable: true;
	mount: (options: NativeBrowserMountOptions) => Promise<void>;
	unmount: (id: string) => Promise<void>;
	setVisible: (id: string, visible: boolean) => Promise<void>;
	control: (
		id: string,
		action: 'navigate' | 'back' | 'forward' | 'reload' | 'stop',
		url?: string,
	) => Promise<void>;
	execute: (id: string, script: string) => Promise<unknown>;
	/** Captures the webview contents and returns base64 PNG bytes. */
	screenshot: (id: string) => Promise<string>;
	subscribe: (
		id: string,
		listener: (event: NativeBrowserNavigationEvent) => void,
	) => () => void;
	subscribeNewTab: (
		id: string,
		listener: (event: NativeBrowserNewTabEvent) => void,
	) => () => void;
	subscribeDownload: (
		id: string,
		listener: (event: NativeBrowserDownloadEvent) => void,
	) => () => void;
	openWindow: (url: string) => Promise<void>;
}

export interface NativeBrowserNewTabEvent {
	id: string;
	url: string;
}

export interface NativeBrowserDownloadEvent {
	id: string;
	url: string;
	status: 'requested' | 'finished';
	path?: string | null;
	success?: boolean | null;
}

export interface NativeBrowserNavigationEvent {
	id: string;
	url: string;
	loading: boolean;
}

export interface NativeBrowserMountOptions {
	id: string;
	url: string;
	reloadKey: number;
	bounds: NativeBrowserBounds;
	visible: boolean;
	/** Script injected before page scripts on every navigation. */
	initScript?: string;
}

export function registerNativeBrowserBridge() {
	const win = window as unknown as {
		OTTO_NATIVE_BROWSER?: NativeBrowserBridge;
	};
	if (win.OTTO_NATIVE_BROWSER) return;

	const navigationListeners = new Map<
		string,
		Set<(event: NativeBrowserNavigationEvent) => void>
	>();
	const newTabListeners = new Map<
		string,
		Set<(event: NativeBrowserNewTabEvent) => void>
	>();
	const downloadListeners = new Map<
		string,
		Set<(event: NativeBrowserDownloadEvent) => void>
	>();
	// Browser webviews belong to this window only, so the backend targets
	// navigation events at this window label to keep tabs isolated per window.
	const navigationReady = listen<NativeBrowserNavigationEvent>(
		'native-browser-navigation',
		({ payload }) => {
			for (const listener of navigationListeners.get(payload.id) ?? []) {
				listener(payload);
			}
		},
		{ target: getCurrentWindow().label },
	).catch((error) => {
		console.error('[otto] Failed to listen for browser navigation:', error);
	});
	const newTabReady = listen<NativeBrowserNewTabEvent>(
		'native-browser-new-tab',
		({ payload }) => {
			for (const listener of newTabListeners.get(payload.id) ?? []) {
				listener(payload);
			}
		},
		{ target: getCurrentWindow().label },
	).catch((error) => {
		console.error('[otto] Failed to listen for browser new tabs:', error);
	});
	const downloadReady = listen<NativeBrowserDownloadEvent>(
		'native-browser-download',
		({ payload }) => {
			for (const listener of downloadListeners.get(payload.id) ?? []) {
				listener(payload);
			}
		},
		{ target: getCurrentWindow().label },
	).catch((error) => {
		console.error('[otto] Failed to listen for browser downloads:', error);
	});

	win.OTTO_NATIVE_BROWSER = {
		isAvailable: true,
		async mount(options) {
			await Promise.all([navigationReady, newTabReady, downloadReady]);
			await invoke('native_browser_mount', {
				id: options.id,
				url: options.url,
				reloadKey: options.reloadKey,
				x: options.bounds.x,
				y: options.bounds.y,
				width: options.bounds.width,
				height: options.bounds.height,
				visible: options.visible,
				initScript: options.initScript,
			});
		},
		async unmount(id) {
			await invoke('native_browser_unmount', { id });
		},
		async setVisible(id, visible) {
			await invoke('native_browser_set_visible', { id, visible });
		},
		async control(id, action, url) {
			await invoke('native_browser_control', { id, action, url });
		},
		async execute(id, script) {
			return invoke('native_browser_execute', { id, script });
		},
		async screenshot(id) {
			return invoke<string>('native_browser_screenshot', { id });
		},
		subscribe(id, listener) {
			const listeners = navigationListeners.get(id) ?? new Set();
			listeners.add(listener);
			navigationListeners.set(id, listeners);
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) navigationListeners.delete(id);
			};
		},
		subscribeNewTab(id, listener) {
			const listeners = newTabListeners.get(id) ?? new Set();
			listeners.add(listener);
			newTabListeners.set(id, listeners);
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) newTabListeners.delete(id);
			};
		},
		subscribeDownload(id, listener) {
			const listeners = downloadListeners.get(id) ?? new Set();
			listeners.add(listener);
			downloadListeners.set(id, listeners);
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) downloadListeners.delete(id);
			};
		},
		async openWindow(url) {
			const label = `browser_window_${Date.now()}_${Math.random()
				.toString(36)
				.slice(2)}`;
			const webviewWindow = new WebviewWindow(label, {
				url,
				title: url,
				width: 1200,
				height: 800,
				center: true,
				focus: true,
				zoomHotkeysEnabled: true,
			});
			webviewWindow.once('tauri://error', (event) => {
				console.error('[otto] Failed to open browser window:', event);
			});
		},
	};
}
