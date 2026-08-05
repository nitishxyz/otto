#!/usr/bin/env bun
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { ARTIFACT_RUNTIME_SOURCE } from '../packages/sdk/src/core/src/artifacts/runtime.ts';

const ROOT = import.meta.dir.replace(/[\\/]scripts$/, '');
const OUTPUT_DIRECTORY = join(
	ROOT,
	'packages/sdk/src/core/src/artifacts/browser-runtime',
);
const temporaryRoot = join(ROOT, 'tmp');
await mkdir(temporaryRoot, { recursive: true });
const temporaryDirectory = await mkdtemp(
	join(temporaryRoot, 'curated-browser-runtime-'),
);
const buildDirectory = join(temporaryDirectory, 'build');

async function commonJsBridge(specifier: string): Promise<string> {
	const module = await import(specifier);
	const names = Object.keys(module).filter(
		(name) => name !== 'default' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name),
	);
	return [
		`import Runtime from ${JSON.stringify(specifier)};`,
		'export default Runtime;',
		...names.map((name) => `export const ${name} = Runtime.${name};`),
		'',
	].join('\n');
}

const entries = {
	react: await commonJsBridge('react'),
	'react-jsx-runtime': await commonJsBridge('react/jsx-runtime'),
	'react-jsx-dev-runtime': await commonJsBridge('react/jsx-dev-runtime'),
	'react-dom': await commonJsBridge('react-dom'),
	'react-dom-client': await commonJsBridge('react-dom/client'),
	motion: `export * from 'motion/react';\n`,
	'lucide-react': `export * from 'lucide-react';\n`,
	'otto-artifact': ARTIFACT_RUNTIME_SOURCE,
} as const;

const entrySpecifiers: Record<string, string> = {
	react: 'react',
	'react-jsx-runtime': 'react/jsx-runtime',
	'react-jsx-dev-runtime': 'react/jsx-dev-runtime',
	'react-dom': 'react-dom',
	'react-dom-client': 'react-dom/client',
	motion: 'motion/react',
	'lucide-react': 'lucide-react',
};

const externalModules: Record<string, string> = {
	react: './react.js',
	'react/jsx-runtime': './react-jsx-runtime.js',
	'react/jsx-dev-runtime': './react-jsx-dev-runtime.js',
	'react-dom': './react-dom.js',
	'react-dom/client': './react-dom-client.js',
};

function rewriteExternalImports(source: string): string {
	let rewritten = source;
	for (const [specifier, target] of Object.entries(externalModules)) {
		rewritten = rewritten
			.replaceAll(JSON.stringify(specifier), JSON.stringify(target))
			.replaceAll(`'${specifier}'`, `'${target}'`);
	}
	return rewritten.replace(/[\t ]+$/gm, '');
}

try {
	await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
	await mkdir(OUTPUT_DIRECTORY, { recursive: true });
	await mkdir(buildDirectory, { recursive: true });
	await Promise.all(
		Object.entries(entries).map(async ([name, source]) => {
			const entryPath = join(temporaryDirectory, `${name}.tsx`);
			await writeFile(entryPath, source);
			const result = await Bun.build({
				entrypoints: [entryPath],
				outdir: buildDirectory,
				target: 'browser',
				format: 'esm',
				minify: true,
				sourcemap: 'none',
				naming: { entry: `${name}.[ext]` },
				plugins: [
					{
						name: 'otto-curated-browser-externals',
						setup(builder) {
							builder.onResolve(
								{ filter: /^(?:react|react-dom)(?:\/.*)?$/ },
								(args) => {
									if (
										(name === 'react-jsx-runtime' ||
											name === 'react-jsx-dev-runtime') &&
										args.path === 'react'
									) {
										return undefined;
									}
									if (args.path === entrySpecifiers[name]) return undefined;
									const path = externalModules[args.path];
									return path ? { path, external: true } : undefined;
								},
							);
						},
					},
				],
			});
			if (!result.success) {
				throw new Error(
					result.logs.map((log) => log.message).join('\n') ||
						`Failed to build ${name}`,
				);
			}
			const output = result.outputs.find(
				(file) => basename(file.path) === `${name}.js`,
			);
			if (!output)
				throw new Error(`Missing browser runtime output for ${name}`);
			const contents = rewriteExternalImports(
				await readFile(output.path, 'utf8'),
			);
			await writeFile(
				join(OUTPUT_DIRECTORY, `${name}.txt`),
				`/* Otto curated browser runtime */\n${contents}`,
			);
		}),
	);
	const runtimeHash = createHash('sha256');
	for (const name of Object.keys(entries).sort()) {
		runtimeHash.update(
			await readFile(join(OUTPUT_DIRECTORY, `${name}.txt`), 'utf8'),
		);
	}
	await writeFile(
		join(OUTPUT_DIRECTORY, 'runtime-hash.txt'),
		`${runtimeHash.digest('hex')}\n`,
	);
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
