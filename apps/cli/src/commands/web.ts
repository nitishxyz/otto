import { Option, type Command } from 'commander';
import { openAuthUrl } from '@ottocode/sdk';
import { createWebServer, type WebServerContext } from '../web-server.ts';
import { colors } from '../ui.ts';

function getLocalIP(): string {
	try {
		const { networkInterfaces } = require('node:os');
		const nets = networkInterfaces();
		for (const name of Object.keys(nets)) {
			for (const net of nets[name]) {
				if (net.family === 'IPv4' && !net.internal) {
					return net.address;
				}
			}
		}
	} catch {}
	return '0.0.0.0';
}

export interface WebOptions {
	url?: string;
	api?: string;
	port?: number;
	network: boolean;
	noOpen: boolean;
	project?: string;
	context?: WebServerContext;
}

export interface StartedWebUi {
	apiUrl: string;
	webUrl: string;
	server: ReturnType<typeof createWebServer>['server'];
}

function validateApiUrl(apiUrl: string): void {
	try {
		new URL(apiUrl);
	} catch {
		console.error(`Invalid API URL: ${apiUrl}`);
		process.exit(1);
	}
}

async function ensureRemoteApi(apiUrl: string): Promise<void> {
	try {
		await fetch(apiUrl, { method: 'GET', signal: AbortSignal.timeout(3000) });
	} catch {
		console.log(colors.yellow(`  ⚠ API server at ${apiUrl} is not responding`));
		console.log(
			colors.dim(
				'    Starting web UI anyway — it will retry when the server comes up',
			),
		);
	}
}

export async function startWebUi(
	opts: WebOptions,
	version: string,
): Promise<StartedWebUi | null> {
	const explicitApiUrl = opts.url ?? opts.api;
	let apiUrl = explicitApiUrl;
	let webPort = opts.port ?? 0;
	let context = opts.context;
	let allowPortFallback = false;

	if (apiUrl) {
		validateApiUrl(apiUrl);
		await ensureRemoteApi(apiUrl);
	} else {
		const projectRoot = opts.project ?? process.cwd();
		const { ensureAuth } = await import('../middleware/with-auth.ts');
		if (!(await ensureAuth(projectRoot))) return null;
		const { ensureDaemonProject } = await import('../daemon.ts');
		const serverContext = await ensureDaemonProject({
			version,
			projectRoot,
		});
		apiUrl = serverContext.baseUrl;
		const serverUrl = new URL(serverContext.baseUrl);
		const serverPort = Number(serverUrl.port);
		webPort = opts.port ?? serverPort + 1;
		// The daemon serves many projects; another `otto web` may already own
		// the preferred port. Fall back to a random port unless the user asked
		// for a specific one.
		allowPortFallback = opts.port === undefined;
		context = {
			projectId: serverContext.projectId,
			projectRoot: serverContext.projectRoot,
			serverToken: serverContext.token,
		};
	}

	let webServer: ReturnType<typeof createWebServer>;
	try {
		webServer = createWebServer(webPort, apiUrl, opts.network, context);
	} catch (error) {
		if (!allowPortFallback) throw error;
		webServer = createWebServer(0, apiUrl, opts.network, context);
	}
	const { port: actualWebPort, server } = webServer;

	const displayHost = opts.network ? getLocalIP() : 'localhost';
	const webUrl = `http://${displayHost}:${actualWebPort}`;

	console.log('');
	console.log(colors.bold('  ⚡ otto web') + colors.dim(` v${version}`));
	console.log('');
	console.log(`  ${colors.dim('Web UI')}  ${colors.cyan(webUrl)}`);
	console.log(`  ${colors.dim('API')}     ${colors.cyan(apiUrl)}`);
	if (context?.projectRoot) {
		console.log(
			`  ${colors.dim('Project')} ${colors.cyan(context.projectRoot)}`,
		);
	}
	console.log('');
	console.log(colors.dim('  Press Ctrl+C to stop'));
	console.log('');

	if (!opts.noOpen) {
		await openAuthUrl(webUrl);
	}

	return { apiUrl, webUrl, server };
}

export async function handleWeb(opts: WebOptions, version: string) {
	const started = await startWebUi(opts, version);
	if (!started) return;

	const shutdown = () => {
		started.server.stop(true);
		process.exit(0);
	};
	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);

	await new Promise(() => {});
}

export function registerWebCommand(program: Command, version: string) {
	program
		.command('web')
		.description('Open Web UI for this project')
		.option(
			'--url <api-url>',
			'Use an existing API server instead of the local daemon',
		)
		.addOption(
			new Option('--api <url>', 'Deprecated alias for --url').hideHelp(),
		)
		.option('-p, --port <port>', 'Web UI port', (v) => parseInt(v, 10))
		.option('--network', 'Bind to 0.0.0.0 for network access', false)
		.option('--no-open', 'Do not open browser automatically')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			await handleWeb(
				{
					url: opts.url,
					api: opts.api,
					port: opts.port,
					network: opts.network,
					noOpen: !opts.open,
					project: opts.project,
				},
				version,
			);
		});
}
