import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './src/App.tsx';
import { ThemeProvider } from './src/theme.ts';
import { configureApi } from './src/api.ts';

configureApi();

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

function gracefulExit(code: number) {
	if (exiting) return;
	exiting = true;
	try {
		destroyRenderer();
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
		<App onQuit={handleQuit} />
	</ThemeProvider>,
);
