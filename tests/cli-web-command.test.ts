import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import { Command } from 'commander';
import * as sdkActual from '@ottocode/sdk';
import * as serverActual from '@ottocode/server';
import * as databaseActual from '@ottocode/database';
import * as apiActual from '@ottocode/api';
import * as withAuthActual from '@ottocode/cli/src/middleware/with-auth.ts';
import * as daemonActual from '@ottocode/cli/src/daemon.ts';
import * as customCommandsActual from '@ottocode/cli/src/custom-commands.ts';
import * as gitignoreActual from '@ottocode/cli/src/gitignore.ts';

const realSdk = { ...sdkActual };
const realServer = { ...serverActual };
const realDatabase = { ...databaseActual };
const realApi = { ...apiActual };
const realWithAuth = { ...withAuthActual };
const realDaemon = { ...daemonActual };
const realCustomCommands = { ...customCommandsActual };
const realGitignore = { ...gitignoreActual };

const openAuthUrlMock = mock(async () => true);
const createWebServerMock = mock(() => ({
	port: 4567,
	server: { stop: mock(() => {}) },
}));
const ensureAuthMock = mock(async () => true);
const ensureDaemonProjectMock = mock(async () => ({
	baseUrl: 'http://127.0.0.1:4317',
	projectId: 'project-id',
	projectRoot: '/tmp/project',
	token: 'server-token',
	authHeaders: { Authorization: 'Bearer server-token' },
}));
const fetchMock = mock(async () => new Response('ok'));

mock.module('@ottocode/sdk', () => ({
	...realSdk,
	openAuthUrl: openAuthUrlMock,
	logger: { error: mock(() => {}) },
	loadConfig: mock(async () => ({ projectRoot: '/tmp/project' })),
	printQRCode: mock(async () => {}),
}));

mock.module('@ottocode/cli/src/cli-deps.ts', () => ({
	logger: { error: mock(() => {}) },
	setDebugEnabled: mock(() => {}),
	setTraceEnabled: mock(() => {}),
}));

mock.module('@ottocode/cli/src/web-server.ts', () => ({
	createWebServer: createWebServerMock,
}));

mock.module('@ottocode/cli/src/middleware/with-auth.ts', () => ({
	...realWithAuth,
	ensureAuth: ensureAuthMock,
}));

mock.module('@ottocode/cli/src/daemon.ts', () => ({
	...realDaemon,
	ensureDaemonProject: ensureDaemonProjectMock,
}));

mock.module('@ottocode/cli/src/custom-commands.ts', () => ({
	...realCustomCommands,
	runDiscoveredCommand: mock(async () => false),
}));

mock.module('@ottocode/cli/src/gitignore.ts', () => ({
	...realGitignore,
	ensureProjectOttoIgnored: mock(async () => false),
}));

mock.module('@ottocode/server', () => ({
	...realServer,
	createApp: mock(() => ({ fetch: mock(() => new Response('ok')) })),
	setDaemonId: mock(() => {}),
	setServerPort: mock(() => {}),
	setServerVersion: mock(() => {}),
	shutdownProjectManager: mock(async () => {}),
	bunWebSocket: {},
}));

mock.module('@ottocode/database', () => ({
	...realDatabase,
	getDb: mock(async () => ({})),
}));

mock.module('@ottocode/api', () => ({
	...realApi,
	startTunnel: mock(async () => ({
		data: { ok: true, url: 'https://tunnel.test' },
	})),
	stopTunnel: mock(async () => ({})),
}));

afterAll(() => {
	mock.module('@ottocode/sdk', () => realSdk);
	mock.module('@ottocode/server', () => realServer);
	mock.module('@ottocode/database', () => realDatabase);
	mock.module('@ottocode/api', () => realApi);
	mock.module('@ottocode/cli/src/middleware/with-auth.ts', () => realWithAuth);
	mock.module('@ottocode/cli/src/daemon.ts', () => realDaemon);
	mock.module('@ottocode/cli/src/custom-commands.ts', () => realCustomCommands);
	mock.module('@ottocode/cli/src/gitignore.ts', () => realGitignore);
});

const webModulePromise = import('@ottocode/cli/src/commands/web.ts');
const serveModulePromise = import('@ottocode/cli/src/commands/lazy/serve.ts');
const cliModulePromise = import('@ottocode/cli/src/cli.ts');

describe('CLI web command UX', () => {
	afterEach(() => {
		openAuthUrlMock.mockClear();
		createWebServerMock.mockClear();
		ensureAuthMock.mockClear();
		ensureAuthMock.mockImplementation(async () => true);
		ensureDaemonProjectMock.mockClear();
		ensureDaemonProjectMock.mockImplementation(async () => ({
			baseUrl: 'http://127.0.0.1:4317',
			projectId: 'project-id',
			projectRoot: '/tmp/project',
			token: 'server-token',
			authHeaders: { Authorization: 'Bearer server-token' },
		}));
		fetchMock.mockClear();
		fetchMock.mockImplementation(async () => new Response('ok'));
		globalThis.fetch = fetchMock as unknown as typeof fetch;
	});

	it('registers web as the preferred command without showing the legacy --api alias', async () => {
		const { registerWebCommand } = await webModulePromise;
		const program = new Command();
		program.name('otto');
		registerWebCommand(program, 'test');

		const help = program.commands
			.find((command) => command.name() === 'web')
			?.helpInformation();

		expect(help).toContain('Open Web UI for this project');
		expect(help).toContain('--url <api-url>');
		expect(help).not.toContain('--api <url>');
	});

	it('marks serve as an advanced standalone foreground server', async () => {
		const { registerServeCommand } = await serveModulePromise;
		const program = new Command();
		program.name('otto');
		registerServeCommand(program, 'test');

		const help = program.commands
			.find((command) => command.name() === 'serve')
			?.helpInformation();

		expect(help).toContain(
			'Advanced: run a standalone foreground API/Web server',
		);
	});

	it('shows web in top-level help and hides the legacy root --web alias', async () => {
		const { createCli } = await cliModulePromise;
		const program = createCli('test');
		const help = program.helpInformation();

		expect(help).toContain('web');
		expect(help).toContain('Open Web UI for this project');
		expect(help).toContain('Advanced: run a standalone foreground API/Web');
		expect(help).not.toContain('--web');
	});

	it('uses an explicit API URL without ensuring a local daemon', async () => {
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const { startWebUi } = await webModulePromise;

		const started = await startWebUi(
			{
				url: 'https://api.example.test',
				port: 0,
				network: false,
				noOpen: true,
			},
			'test',
		);

		expect(started?.apiUrl).toBe('https://api.example.test');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(createWebServerMock).toHaveBeenCalledWith(
			0,
			'https://api.example.test',
			false,
			undefined,
		);
		expect(ensureAuthMock).toHaveBeenCalledTimes(0);
		expect(ensureDaemonProjectMock).toHaveBeenCalledTimes(0);
		expect(openAuthUrlMock).toHaveBeenCalledTimes(0);
	});

	it('ensures the local daemon and project when no API URL is provided', async () => {
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const { startWebUi } = await webModulePromise;

		const started = await startWebUi(
			{
				project: '/tmp/project',
				network: false,
				noOpen: true,
			},
			'test',
		);

		expect(started?.apiUrl).toBe('http://127.0.0.1:4317');
		expect(ensureAuthMock).toHaveBeenCalledWith('/tmp/project');
		expect(ensureDaemonProjectMock).toHaveBeenCalledWith({
			version: 'test',
			projectRoot: '/tmp/project',
		});
		expect(fetchMock).toHaveBeenCalledTimes(0);
		expect(createWebServerMock).toHaveBeenCalledWith(
			4318,
			'http://127.0.0.1:4317',
			false,
			{
				projectId: 'project-id',
				projectRoot: '/tmp/project',
				serverToken: 'server-token',
			},
		);
		expect(openAuthUrlMock).toHaveBeenCalledTimes(0);
	});
});
