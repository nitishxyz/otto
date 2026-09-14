import type { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export function waitForBrowserWindow(
	webviewWindow: Pick<WebviewWindow, 'once'>,
): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup: (() => void)[] = [];
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			for (const unlisten of cleanup) unlisten();
			if (error) reject(error);
			else resolve();
		};
		const timeout = setTimeout(
			() => finish(new Error('Browser window creation timed out')),
			15_000,
		);
		const register = (registration: Promise<() => void>) => {
			void registration.then(
				(unlisten) => {
					if (settled) unlisten();
					else cleanup.push(unlisten);
				},
				(error: unknown) =>
					finish(error instanceof Error ? error : new Error(String(error))),
			);
		};
		register(webviewWindow.once('tauri://created', () => finish()));
		register(
			webviewWindow.once('tauri://error', ({ payload }) => {
				finish(new Error(`Failed to open browser window: ${String(payload)}`));
			}),
		);
	});
}
