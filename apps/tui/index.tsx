import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './src/App.tsx';
import { ThemeProvider } from './src/theme.ts';
import { configureApi, configureProjectContext } from './src/api.ts';
import { discoverLocalDaemon } from './src/daemon.ts';
import { enableLinuxShiftEnterReporting } from './src/lib/terminal-keyboard.ts';
import { TerminalDimensionsProvider } from './src/terminal-dimensions.tsx';

// Standalone entry: prefer a running local daemon unless the server is
// explicitly configured via env.
if (!process.env.OTTO_SERVER_URL && !process.env.OTTO_PORT) {
	const daemon = await discoverLocalDaemon();
	if (daemon) {
		configureProjectContext({
			baseUrl: daemon.baseUrl,
			projectRoot: process.env.OTTO_PROJECT_ROOT || process.cwd(),
			token: daemon.token,
		});
	}
}
configureApi();

const renderer = await createCliRenderer({
	exitOnCtrlC: false,
	screenMode: 'alternate-screen',
	targetFps: 30,
});
enableLinuxShiftEnterReporting(renderer.capabilities);
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

function gracefulExit(
	code: number,
	failure?: { label: string; reason: unknown },
) {
	if (exiting) return;
	exiting = true;
	try {
		destroyRenderer();
	} catch {}
	if (failure) console.error(failure.label, failure.reason);
	setTimeout(() => process.exit(code), 100);
}

process.on('uncaughtException', (error) => {
	gracefulExit(1, { label: 'Uncaught exception:', reason: error });
});

process.on('unhandledRejection', (reason) => {
	gracefulExit(1, { label: 'Unhandled rejection:', reason });
});

process.on('SIGINT', () => gracefulExit(0));
process.on('SIGTERM', () => gracefulExit(0));

function handleQuit() {
	gracefulExit(0);
}

root.render(
	<TerminalDimensionsProvider>
		<ThemeProvider>
			<App onQuit={handleQuit} />
		</ThemeProvider>
	</TerminalDimensionsProvider>,
);
