import { Command } from 'commander';
import { logger, setDebugEnabled, setTraceEnabled } from './cli-deps.ts';
import {
	registerServeCommand,
	registerAskCommand,
	registerSessionsCommand,
	registerAuthCommand,
	registerModelsCommand,
	registerProvidersCommand,
	registerAgentsCommand,
	registerToolsCommand,
	registerSkillsCommand,
	registerScaffoldCommand,
	registerDoctorCommand,
	registerDebugCommand,
	registerUpgradeCommand,
	registerOttoRouterCommand,
	registerShareCommand,
	registerMCPCommand,
	registerWebCommand,
	registerStorageCommand,
} from './commands/index.ts';
import { runDiscoveredCommand } from './custom-commands.ts';
import { ensureProjectOttoIgnored } from './gitignore.ts';

const SKIP_SERVER_COMMANDS = new Set([
	'serve',
	'upgrade',
	'help',
	'auth',
	'providers',
	'debug',
	'web',
	'ask',
	'run',
	'do',
	'a',
	'sessions',
	'share',
	'storage',
]);

const NO_EPHEMERAL_SERVER_COMMANDS = new Set([
	'serve',
	'upgrade',
	'help',
	'auth',
	'providers',
	'debug',
	'web',
	'storage',
]);

export function createCli(version: string): Command {
	const program = new Command();

	program
		.name('otto')
		.description('AI-powered development assistant CLI')
		.version(version, '-v, --version', 'Print version and exit')
		.option(
			'--ci',
			'Disable interactive auth onboarding and rely on env/stored auth',
		)
		.option('--web', 'Open Web UI instead of TUI')
		.option('--agent <name>', 'Initial TUI agent')
		.option('--provider <provider>', 'Initial TUI provider')
		.option('--model <model>', 'Initial TUI model')
		.hook('preAction', async (_thisCommand, actionCommand) => {
			const cmdName = actionCommand.name();
			const parentName = actionCommand.parent?.name();
			if (
				!SKIP_SERVER_COMMANDS.has(cmdName) &&
				!(parentName && SKIP_SERVER_COMMANDS.has(parentName))
			) {
				const { ensureServer } = await import('./ask/server.ts');
				await ensureServer();
			}
		});

	registerServeCommand(program, version);
	registerAskCommand(program);
	registerSessionsCommand(program);
	registerAuthCommand(program);
	registerModelsCommand(program);
	registerProvidersCommand(program);
	registerAgentsCommand(program);
	registerToolsCommand(program);
	registerSkillsCommand(program);
	registerScaffoldCommand(program);
	registerDoctorCommand(program);
	registerDebugCommand(program);
	registerUpgradeCommand(program, version);
	registerOttoRouterCommand(program);
	registerShareCommand(program);
	registerMCPCommand(program);
	registerWebCommand(program, version);
	registerStorageCommand(program);

	return program;
}

const ROOT_VALUE_FLAGS = new Set([
	'--agent',
	'--model',
	'--port',
	'--project',
	'--provider',
]);

function getFlagValue(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	if (index < 0) return undefined;
	const value = argv[index + 1];
	return value && !value.startsWith('-') ? value : undefined;
}

function findCommandArg(argv: string[]): string | undefined {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (ROOT_VALUE_FLAGS.has(arg)) {
			i++;
			continue;
		}
		if (!arg.startsWith('-')) return arg;
	}
	return undefined;
}

export async function runCli(argv: string[], version: string): Promise<void> {
	const program = createCli(version);
	const previousCiMode = process.env.OTTO_CI_MODE;
	let shouldStopEphemeralServer = false;
	if (argv.includes('--ci')) {
		process.env.OTTO_CI_MODE = '1';
	}
	try {
		const projectRoot = getFlagValue(argv, '--project') ?? process.cwd();
		const cmd = findCommandArg(argv);
		if (cmd !== 'storage') {
			await ensureProjectOttoIgnored(projectRoot);
		}
		shouldStopEphemeralServer = Boolean(
			cmd && !NO_EPHEMERAL_SERVER_COMMANDS.has(cmd),
		);
		if (cmd) {
			const discovered = await runDiscoveredCommand(
				cmd,
				argv.slice(argv.indexOf(cmd) + 1),
				projectRoot,
			);
			if (discovered) return;
		}

		if (
			argv.length === 0 ||
			(!cmd &&
				!argv.includes('-h') &&
				!argv.includes('--help') &&
				!argv.includes('-v') &&
				!argv.includes('--version'))
		) {
			const debugEnabled = argv.includes('--debug');
			const traceEnabled = argv.includes('--trace');
			if (debugEnabled) {
				setDebugEnabled(true);
			}
			if (traceEnabled) {
				setTraceEnabled(true);
			}

			const useWeb = argv.includes('--web');
			const portValue = getFlagValue(argv, '--port');
			const port = portValue ? Number(portValue) : undefined;
			const initialProvider = getFlagValue(argv, '--provider')?.trim();
			const initialModel = getFlagValue(argv, '--model')?.trim();
			const initialAgent = getFlagValue(argv, '--agent')?.trim();
			if (initialProvider) {
				const { loadConfig, hasConfiguredProvider, getConfiguredProviderIds } =
					await import('@ottocode/sdk');
				const cfg = await loadConfig(projectRoot);
				if (!hasConfiguredProvider(cfg, initialProvider)) {
					logger.error(`Provider not supported: ${initialProvider}`);
					logger.error(
						`Available providers: ${getConfiguredProviderIds(cfg).join(', ')}`,
					);
					process.exitCode = 1;
					return;
				}
			}
			const initialSession = {
				...(initialAgent ? { agent: initialAgent } : {}),
				...(initialProvider ? { provider: initialProvider } : {}),
				...(initialModel ? { model: initialModel } : {}),
				...(initialModel ? { allowUnknownModel: true } : {}),
			};

			if (useWeb) {
				const noOpen = argv.includes('--no-open');
				const networkFlag = argv.includes('--network');
				const { handleServe } = await import('./commands/serve.ts');
				await handleServe(
					{
						project: projectRoot,
						port,
						network: networkFlag,
						noOpen,
						tunnel: false,
						apiOnly: false,
					},
					version,
				);
				return;
			}

			const { ensureAuth } = await import('./middleware/with-auth.ts');
			if (!(await ensureAuth(projectRoot))) return;
			const { startApiServer } = await import('./commands/serve.ts');
			const server = await startApiServer({ project: projectRoot, port });
			const { startTui } = await import('@ottocode/tui');
			await startTui(server.port, server.stop, server.webUrl, initialSession);
			return;
		}

		await program.parseAsync(argv, { from: 'user' });
	} finally {
		if (previousCiMode === undefined) {
			delete process.env.OTTO_CI_MODE;
		} else {
			process.env.OTTO_CI_MODE = previousCiMode;
		}
		if (shouldStopEphemeralServer) {
			const { stopEphemeralServer } = await import('./ask/server.ts');
			await stopEphemeralServer();
		}
	}
}

process.on('unhandledRejection', (reason) => {
	logger.error('Unhandled Promise Rejection', reason);
	process.exit(1);
});

process.on('uncaughtException', (error) => {
	logger.error('Uncaught Exception', error);
	process.exit(1);
});
