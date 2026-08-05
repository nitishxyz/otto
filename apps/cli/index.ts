// Side-effect import to suppress bigint-buffer warning - must be first
import './src/suppress-warnings.ts';

import { bootstrapBinaries } from './src/bootstrap-bins.ts';
import PKG from './package.json' with { type: 'json' };
import { runAcp } from '@ottocode/acp';

let argv = process.argv.slice(2);

if (argv[0] === 'otto' || argv[0]?.endsWith('/otto')) {
	argv = argv.slice(1);
}

if (argv[0] === '__extension-host') {
	import('@ottocode/sdk').then(({ runNativeExtensionHost }) =>
		runNativeExtensionHost().catch((error) => {
			console.error(error instanceof Error ? error.stack : String(error));
			process.exit(1);
		}),
	);
} else if (argv.includes('--acp')) {
	bootstrapBinaries();
	runAcp();
} else {
	bootstrapBinaries();
	import('./src/cli.ts').then(({ runCli }) =>
		runCli(argv, (PKG as { version: string }).version)
			.then(() => process.exit(0))
			.catch(async (error) => {
				const { DaemonVersionMismatchError } = await import('./src/daemon.ts');
				if (error instanceof DaemonVersionMismatchError) {
					try {
						const { offerDaemonMismatchUpgrade } = await import(
							'./src/commands/upgrade.ts'
						);
						const upgraded = await offerDaemonMismatchUpgrade(error, {
							interactive: argv.includes('--ci') ? false : undefined,
						});
						if (upgraded) {
							console.log('Upgrade complete. Run otto again to continue.');
						}
						process.exit(upgraded ? 0 : 1);
					} catch (upgradeError) {
						const upgradeMessage =
							upgradeError instanceof Error
								? (upgradeError.stack ?? upgradeError.message)
								: String(upgradeError);
						console.error(upgradeMessage);
						process.exit(1);
					}
				}
				const message =
					error instanceof Error
						? (error.stack ?? error.message)
						: String(error);
				console.error(message);
				process.exit(1);
			}),
	);
}
