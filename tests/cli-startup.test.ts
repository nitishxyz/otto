import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import * as customCommandsActual from '@ottocode/cli/src/custom-commands.ts';
import * as gitignoreActual from '@ottocode/cli/src/gitignore.ts';
import * as daemonActual from '@ottocode/cli/src/daemon.ts';
import * as withAuthActual from '@ottocode/cli/src/middleware/with-auth.ts';
import * as askServerActual from '@ottocode/cli/src/ask/server.ts';
import * as serveActual from '@ottocode/cli/src/commands/serve.ts';
import * as commandsIndexActual from '@ottocode/cli/src/commands/index.ts';

const realCustomCommands = { ...customCommandsActual };
const realGitignore = { ...gitignoreActual };
const realDaemon = { ...daemonActual };
const realWithAuth = { ...withAuthActual };
const realAskServer = { ...askServerActual };
const realServe = { ...serveActual };
const realCommandsIndex = { ...commandsIndexActual };

const ensureAuthMock = mock(async () => true);
const startApiServerMock = mock(async () => ({
	port: 4317,
	stop: async () => {},
}));
const ensureDaemonProjectMock = mock(async () => ({
	baseUrl: 'http://127.0.0.1:4317',
	projectId: 'project-id',
	projectRoot: process.cwd(),
	token: 'token',
	authHeaders: { Authorization: 'Bearer token' },
}));
const handleServeMock = mock(async () => {});
const startTuiMock = mock(async () => {});
const ensureServerMock = mock(async () => 'http://localhost:4317');
const stopEphemeralServerMock = mock(async () => {});
const runDiscoveredCommandMock = mock(async () => false);
const loggerErrorMock = mock(() => {});
const setDebugEnabledMock = mock(() => {});
const setTraceEnabledMock = mock(() => {});
const ensureProjectOttoIgnoredMock = mock(async () => false);

mock.module('@ottocode/cli/src/cli-deps.ts', () => ({
	logger: { error: loggerErrorMock },
	setDebugEnabled: setDebugEnabledMock,
	setTraceEnabled: setTraceEnabledMock,
}));

mock.module('@ottocode/cli/src/commands/index.ts', () => ({
	...realCommandsIndex,
	registerServeCommand: () => {},
	registerAskCommand: () => {},
	registerSessionsCommand: () => {},
	registerAuthCommand: () => {},
	registerModelsCommand: () => {},
	registerProvidersCommand: () => {},
	registerAgentsCommand: () => {},
	registerToolsCommand: () => {},
	registerSkillsCommand: () => {},
	registerPluginsCommand: () => {},
	registerScaffoldCommand: () => {},
	registerDoctorCommand: () => {},
	registerDebugCommand: () => {},
	registerUpgradeCommand: () => {},
	registerOttoRouterCommand: () => {},
	registerShareCommand: () => {},
	registerMCPCommand: () => {},
	registerWebCommand: () => {},
	registerStorageCommand: () => {},
	registerServiceCommand: () => {},
	registerProjectsCommand: () => {},
	registerMigrateCommand: () => {},
}));

mock.module('@ottocode/cli/src/custom-commands.ts', () => ({
	...realCustomCommands,
	runDiscoveredCommand: runDiscoveredCommandMock,
}));

mock.module('@ottocode/cli/src/gitignore.ts', () => ({
	...realGitignore,
	ensureProjectOttoIgnored: ensureProjectOttoIgnoredMock,
}));

mock.module('@ottocode/cli/src/commands/serve.ts', () => ({
	...realServe,
	startApiServer: startApiServerMock,
	handleServe: handleServeMock,
}));

mock.module('@ottocode/cli/src/daemon.ts', () => ({
	...realDaemon,
	ensureDaemonProject: ensureDaemonProjectMock,
}));

mock.module('@ottocode/tui', () => ({ startTui: startTuiMock }));

mock.module('@ottocode/cli/src/middleware/with-auth.ts', () => ({
	...realWithAuth,
	ensureAuth: ensureAuthMock,
}));

mock.module('@ottocode/cli/src/ask/server.ts', () => ({
	...realAskServer,
	ensureServer: ensureServerMock,
	stopEphemeralServer: stopEphemeralServerMock,
}));

afterAll(() => {
	mock.module('@ottocode/cli/src/custom-commands.ts', () => realCustomCommands);
	mock.module('@ottocode/cli/src/gitignore.ts', () => realGitignore);
	mock.module('@ottocode/cli/src/daemon.ts', () => realDaemon);
	mock.module('@ottocode/cli/src/middleware/with-auth.ts', () => realWithAuth);
	mock.module('@ottocode/cli/src/ask/server.ts', () => realAskServer);
	mock.module('@ottocode/cli/src/commands/serve.ts', () => realServe);
	mock.module('@ottocode/cli/src/commands/index.ts', () => realCommandsIndex);
});

const cliModulePromise = import('@ottocode/cli/src/cli.ts');

describe('cli startup auth gating', () => {
	afterEach(() => {
		delete process.env.OTTO_CI_MODE;
		ensureAuthMock.mockReset();
		ensureAuthMock.mockImplementation(async () => true);
		startApiServerMock.mockReset();
		startApiServerMock.mockImplementation(async () => ({
			port: 4317,
			stop: async () => {},
		}));
		ensureDaemonProjectMock.mockReset();
		ensureDaemonProjectMock.mockImplementation(async () => ({
			baseUrl: 'http://127.0.0.1:4317',
			projectId: 'project-id',
			projectRoot: process.cwd(),
			token: 'token',
			authHeaders: { Authorization: 'Bearer token' },
		}));
		handleServeMock.mockReset();
		startTuiMock.mockReset();
		ensureServerMock.mockReset();
		ensureServerMock.mockImplementation(async () => 'http://localhost:4317');
		stopEphemeralServerMock.mockReset();
		runDiscoveredCommandMock.mockReset();
		runDiscoveredCommandMock.mockImplementation(async () => false);
		ensureProjectOttoIgnoredMock.mockReset();
		ensureProjectOttoIgnoredMock.mockImplementation(async () => false);
		loggerErrorMock.mockReset();
		setDebugEnabledMock.mockReset();
		setTraceEnabledMock.mockReset();
	});

	it('does not start the local API server when auth gating fails', async () => {
		ensureAuthMock.mockImplementation(async () => false);
		const { runCli } = await cliModulePromise;

		await runCli([], 'test');

		expect(ensureAuthMock).toHaveBeenCalledTimes(1);
		expect(startApiServerMock).toHaveBeenCalledTimes(0);
		expect(ensureDaemonProjectMock).toHaveBeenCalledTimes(0);
		expect(startTuiMock).toHaveBeenCalledTimes(0);
	});

	it('authenticates before starting the TUI server', async () => {
		const order: string[] = [];
		ensureAuthMock.mockImplementation(async () => {
			order.push('auth');
			return true;
		});
		ensureDaemonProjectMock.mockImplementation(async () => {
			order.push('daemon');
			return {
				baseUrl: 'http://127.0.0.1:4317',
				projectId: 'project-id',
				projectRoot: process.cwd(),
				token: 'token',
				authHeaders: { Authorization: 'Bearer token' },
			};
		});
		startTuiMock.mockImplementation(async () => {
			order.push('tui');
		});

		const { runCli } = await cliModulePromise;
		await runCli([], 'test');

		expect(order).toEqual(['auth', 'daemon', 'tui']);
	});

	it('enables ci auth mode when launched with --ci', async () => {
		let ciModeDuringAuth: string | undefined;
		ensureAuthMock.mockImplementation(async () => {
			ciModeDuringAuth = process.env.OTTO_CI_MODE;
			return true;
		});

		const { runCli } = await cliModulePromise;
		await runCli(['--ci'], 'test');

		expect(ciModeDuringAuth).toBe('1');
		expect(process.env.OTTO_CI_MODE).toBeUndefined();
	});

	it('ensures the project .otto directory is gitignored on startup', async () => {
		const { runCli } = await cliModulePromise;

		await runCli(['--ci'], 'test');

		expect(ensureProjectOttoIgnoredMock).toHaveBeenCalledTimes(1);
		expect(ensureProjectOttoIgnoredMock).toHaveBeenCalledWith(process.cwd());
	});
});
