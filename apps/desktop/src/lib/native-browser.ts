import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
	subscribe: (
		id: string,
		listener: (event: NativeBrowserNavigationEvent) => void,
	) => () => void;
	openWindow: (url: string) => Promise<void>;
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
}

export function registerNativeBrowserBridge() {
	const win = window as unknown as {
		OTTO_NATIVE_BROWSER?: NativeBrowserBridge;
	};

	const navigationListeners = new Map<
		string,
		Set<(event: NativeBrowserNavigationEvent) => void>
	>();
	const navigationReady = listen<NativeBrowserNavigationEvent>(
		'native-browser-navigation',
		({ payload }) => {
			for (const listener of navigationListeners.get(payload.id) ?? []) {
				listener(payload);
			}
		},
	).catch((error) => {
		console.error('[otto] Failed to listen for browser navigation:', error);
	});

	win.OTTO_NATIVE_BROWSER = {
		isAvailable: true,
		async mount(options) {
			await navigationReady;
			await invoke('native_browser_mount', {
				id: options.id,
				url: options.url,
				reloadKey: options.reloadKey,
				x: options.bounds.x,
				y: options.bounds.y,
				width: options.bounds.width,
				height: options.bounds.height,
				visible: options.visible,
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
		subscribe(id, listener) {
			const listeners = navigationListeners.get(id) ?? new Set();
			listeners.add(listener);
			navigationListeners.set(id, listeners);
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) navigationListeners.delete(id);
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
