#!/usr/bin/env bun
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type EntryPoint = {
	source: string;
	output: string;
	target?: 'node' | 'browser';
	splitting?: boolean;
};

const packageDir = import.meta.dir;
const distDir = join(packageDir, 'dist');
const packageJson = JSON.parse(
	readFileSync(join(packageDir, 'package.json'), 'utf8'),
);
const bundledPackages = new Set(['@ff-labs/fff-bun', '@ottorouter/ai-sdk']);
const externalArgs = Object.keys(packageJson.dependencies ?? {})
	.filter((dependency) => !bundledPackages.has(dependency))
	.flatMap((dependency) => [
		'--external',
		dependency,
		'--external',
		`${dependency}/*`,
	]);

const entrypoints: EntryPoint[] = [
	{ source: 'src/index.ts', output: 'dist/index.js', splitting: true },
	{ source: 'src/browser.ts', output: 'dist/browser.js', target: 'browser' },
	{
		source: 'src/core/src/tools/builtin/fs/index.ts',
		output: 'dist/core/src/tools/builtin/fs/index.js',
	},
	{
		source: 'src/core/src/tools/builtin/git.ts',
		output: 'dist/core/src/tools/builtin/git.js',
	},
	{
		source: 'src/core/src/tools/builtin/bash.ts',
		output: 'dist/core/src/tools/builtin/bash.js',
	},
	{
		source: 'src/core/src/tools/builtin/shell.ts',
		output: 'dist/core/src/tools/builtin/shell.js',
	},
	{
		source: 'src/core/src/tools/builtin/progress.ts',
		output: 'dist/core/src/tools/builtin/progress.js',
	},
	{
		source: 'src/core/src/tools/builtin/search.ts',
		output: 'dist/core/src/tools/builtin/search.js',
		splitting: true,
	},
	{
		source: 'src/core/src/tools/builtin/patch.ts',
		output: 'dist/core/src/tools/builtin/patch.js',
	},
	{
		source: 'src/core/src/tools/builtin/todos.ts',
		output: 'dist/core/src/tools/builtin/todos.js',
	},
	{
		source: 'src/core/src/tools/builtin/websearch.ts',
		output: 'dist/core/src/tools/builtin/websearch.js',
	},
	{
		source: 'src/core/src/tools/builtin/terminal.ts',
		output: 'dist/core/src/tools/builtin/terminal.js',
	},
	{
		source: 'src/core/src/tools/error.ts',
		output: 'dist/core/src/tools/error.js',
	},
	{
		source: 'src/core/src/tools/bin-manager.ts',
		output: 'dist/core/src/tools/bin-manager.js',
	},
	{
		source: 'src/core/src/search/fff.ts',
		output: 'dist/core/src/search/fff.js',
		splitting: true,
	},
];

console.log('Building @ottocode/sdk package...');

if (existsSync(distDir)) {
	rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(distDir, { recursive: true });

for (const entrypoint of entrypoints) {
	const outfile = join(packageDir, entrypoint.output);
	mkdirSync(dirname(outfile), { recursive: true });

	const result = Bun.spawnSync(
		entrypoint.splitting
			? [
					process.execPath,
					'build',
					join(packageDir, entrypoint.source),
					'--outdir',
					dirname(outfile),
					'--entry-naming',
					'[name].[ext]',
					'--chunk-naming',
					'chunks/[name]-[hash].[ext]',
					'--format=esm',
					`--target=${entrypoint.target ?? 'node'}`,
					'--splitting',
					...externalArgs,
				]
			: [
					process.execPath,
					'build',
					join(packageDir, entrypoint.source),
					'--outfile',
					outfile,
					'--format=esm',
					`--target=${entrypoint.target ?? 'node'}`,
					...externalArgs,
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
