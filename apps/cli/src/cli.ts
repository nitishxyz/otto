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
} from './commands/index.ts';
import { runDiscoveredCommand } from './custom-commands.ts';

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
]);

const NO_EPHEMERAL_SERVER_COMMANDS = new Set([
	'serve',
	'upgrade',
	'help',
	'auth',
	'providers',
	'debug',
	'web',
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
		.hook('preAction', async (_thisCommand, actionCommand) => {
			const cmdName = actionCommand.name();
			if (!SKIP_SERVER_COMMANDS.has(cmdName)) {
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

	return program;
}

export async function runCli(argv: string[], version: string): Promise<void> {
	const program = createCli(version);
	const previousCiMode = process.env.OTTO_CI_MODE;
	let shouldStopEphemeralServer = false;
	if (argv.includes('--ci')) {
		process.env.OTTO_CI_MODE = '1';
	}
	try {
		const projectIdx = argv.indexOf('--project');
		const projectRoot = projectIdx >= 0 ? argv[projectIdx + 1] : process.cwd();

		const cmd = argv.find((arg) => !arg.startsWith('-'));
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
			(argv.every((arg) => arg.startsWith('-')) &&
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
			const portFlagIndex = argv.indexOf('--port');
			const port =
				portFlagIndex >= 0 ? Number(argv[portFlagIndex + 1]) : undefined;

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
			await startTui(server.port, server.stop, server.webUrl);
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
