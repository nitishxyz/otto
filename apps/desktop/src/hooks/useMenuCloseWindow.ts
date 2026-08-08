import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { VIEWER_CLOSE_ACTIVE_TAB_EVENT } from '@ottocode/web-sdk/stores';

/**
 * Handles the native File > Close Window (Cmd/Ctrl+W) menu item. Closes the
 * active viewer tab when one is open; otherwise closes this window.
 */
export function useMenuCloseWindow() {
	useEffect(() => {
		let disposed = false;
		let unlisten: (() => void) | null = null;
		const currentWindow = getCurrentWindow();
		void listen(
			'menu-close-request',
			() => {
				const consumed = !window.dispatchEvent(
					new CustomEvent(VIEWER_CLOSE_ACTIVE_TAB_EVENT, {
						cancelable: true,
					}),
				);
				if (!consumed) void currentWindow.close();
			},
			{ target: currentWindow.label },
		).then((fn) => {
			if (disposed) {
				fn();
				return;
			}
			unlisten = fn;
		});
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, []);
}
