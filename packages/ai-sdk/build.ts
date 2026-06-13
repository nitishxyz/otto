#!/usr/bin/env bun
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const packageDir = import.meta.dir;
const distDir = join(packageDir, 'dist');

const entrypoints = [
	{ source: 'src/index.ts', output: 'dist/index.js' },
	{ source: 'src/catalog.ts', output: 'dist/catalog.js' },
	{ source: 'src/providers/index.ts', output: 'dist/providers/index.js' },
	{ source: 'src/types.ts', output: 'dist/types.js' },
];

console.log('Building @ottorouter/ai-sdk package...');

if (existsSync(distDir)) {
	rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(distDir, { recursive: true });

for (const entrypoint of entrypoints) {
	const outfile = join(packageDir, entrypoint.output);
	mkdirSync(dirname(outfile), { recursive: true });

	const result = Bun.spawnSync(
		[
			process.execPath,
			'build',
			join(packageDir, entrypoint.source),
			'--outfile',
			outfile,
			'--format=esm',
			'--target=node',
			'--packages=external',
		],
		{
			cwd: packageDir,
			stdout: 'inherit',
			stderr: 'inherit',
		},
	);

	if (!result.success) {
		console.error(`Failed to build ${entrypoint.source}`);
		process.exit(1);
	}
}

console.log('Build complete.');
