import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

interface NativeBrowserBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface NativeBrowserMountOptions {
	id: string;
	url: string;
	reloadKey: number;
	bounds: NativeBrowserBounds;
	visible: boolean;
}

export function registerNativeBrowserBridge() {
	const win = window as unknown as {
		OTTO_NATIVE_BROWSER?: {
			isAvailable: true;
			mount: (options: NativeBrowserMountOptions) => Promise<void>;
			unmount: (id: string) => Promise<void>;
			setVisible: (id: string, visible: boolean) => Promise<void>;
			openWindow: (url: string) => Promise<void>;
		};
	};

	win.OTTO_NATIVE_BROWSER = {
		isAvailable: true,
		async mount(options) {
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
