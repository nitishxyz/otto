import { afterEach, describe, expect, it, mock } from 'bun:test';

const ensureAuthMock = mock(async () => true);
const startApiServerMock = mock(async () => ({
	port: 4317,
	stop: async () => {},
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
}));

mock.module('@ottocode/cli/src/custom-commands.ts', () => ({
	runDiscoveredCommand: runDiscoveredCommandMock,
}));

mock.module('@ottocode/cli/src/gitignore.ts', () => ({
	ensureProjectOttoIgnored: ensureProjectOttoIgnoredMock,
}));

mock.module('@ottocode/cli/src/commands/serve.ts', () => ({
	startApiServer: startApiServerMock,
	handleServe: handleServeMock,
}));

mock.module('@ottocode/tui', () => ({ startTui: startTuiMock }));

mock.module('@ottocode/cli/src/middleware/with-auth.ts', () => ({
	ensureAuth: ensureAuthMock,
}));

mock.module('@ottocode/cli/src/ask/server.ts', () => ({
	ensureServer: ensureServerMock,
	stopEphemeralServer: stopEphemeralServerMock,
}));

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
		expect(startTuiMock).toHaveBeenCalledTimes(0);
	});

	it('authenticates before starting the TUI server', async () => {
		const order: string[] = [];
		ensureAuthMock.mockImplementation(async () => {
			order.push('auth');
			return true;
		});
		startApiServerMock.mockImplementation(async () => {
			order.push('server');
			return {
				port: 4317,
				stop: async () => {},
			};
		});
		startTuiMock.mockImplementation(async () => {
			order.push('tui');
		});

		const { runCli } = await cliModulePromise;
		await runCli([], 'test');

		expect(order).toEqual(['auth', 'server', 'tui']);
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
