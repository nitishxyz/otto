import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
// @ts-expect-error Bun file asset import
import treeSitterWorkerPath from '../../node_modules/@opentui/core/parser.worker.js' with {
	type: 'file',
};
import 'opentui-spinner/react';
import { App } from './src/App.tsx';
import { ThemeProvider } from './src/theme.ts';
import { setPort, configureApi } from './src/api.ts';

export async function startTui(
	port: number,
	stopServer?: () => Promise<void>,
	webUrl?: string,
): Promise<void> {
	setPort(port);
	configureApi();
	if (!process.env.OTUI_TREE_SITTER_WORKER_PATH) {
		process.env.OTUI_TREE_SITTER_WORKER_PATH = treeSitterWorkerPath;
	}

	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		screenMode: 'alternate-screen',
		targetFps: 30,
	});
	const root = createRoot(renderer);

	let exiting = false;

	function destroyRenderer() {
		const originalTerminate = Worker.prototype.terminate;
		try {
			// Bun 1.3.6 can segfault when terminating OpenTUI's tree-sitter worker
			// during process shutdown. The process exits immediately after cleanup, so
			// let the OS reap the worker instead of calling Worker.terminate().
			Worker.prototype.terminate = () => {};
			root.unmount();
			renderer.destroy();
		} finally {
			Worker.prototype.terminate = originalTerminate;
		}
	}

	async function gracefulExit(code: number) {
		if (exiting) return;
		exiting = true;
		try {
			destroyRenderer();
		} catch {}
		try {
			if (stopServer) await stopServer();
		} catch {}
		setTimeout(() => process.exit(code), 100);
	}

	process.on('uncaughtException', (error) => {
		console.error('Uncaught exception:', error);
		gracefulExit(1);
	});

	process.on('unhandledRejection', (reason) => {
		console.error('Unhandled rejection:', reason);
		gracefulExit(1);
	});

	process.on('SIGINT', () => gracefulExit(0));
	process.on('SIGTERM', () => gracefulExit(0));

	function handleQuit() {
		gracefulExit(0);
	}

	root.render(
		<ThemeProvider>
			<App onQuit={handleQuit} webUrl={webUrl} />
		</ThemeProvider>,
	);

	await new Promise(() => {});
}
