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
			.catch((error) => {
				const message =
					error instanceof Error
						? (error.stack ?? error.message)
						: String(error);
				console.error(message);
				process.exit(1);
			}),
	);
}
