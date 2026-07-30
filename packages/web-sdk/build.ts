#!/usr/bin/env bun
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
} from 'node:fs';
import { join } from 'node:path';

console.log('🏗️  Building @ottocode/web-sdk package...\n');

const packageDir = import.meta.dir;
const distDir = join(packageDir, 'dist');
const fontsSrcDir = join(packageDir, 'src', 'assets', 'fonts');
const fontsDistDir = join(distDir, 'assets', 'fonts');
const entrypoints = [
	join(packageDir, 'src', 'index.ts'),
	join(packageDir, 'src', 'components', 'index.ts'),
	join(packageDir, 'src', 'components', 'common', 'OttoOIcon.tsx'),
	join(packageDir, 'src', 'hooks', 'index.ts'),
	join(packageDir, 'src', 'lib', 'index.ts'),
	join(packageDir, 'src', 'stores', 'index.ts'),
	join(packageDir, 'src', 'types', 'api.ts'),
];

if (existsSync(distDir)) {
	rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(distDir, { recursive: true });

console.log('📦 Building JavaScript...');
const build = await Bun.build({
	entrypoints,
	outdir: distDir,
	format: 'esm',
	target: 'browser',
	sourcemap: 'external',
	packages: 'external',
	define: {
		'process.env.NODE_ENV': '"production"',
		'import.meta.env.DEV': 'false',
	},
});

if (!build.success) {
	for (const log of build.logs) {
		console.error(log);
	}
	console.error('❌ Failed to build JavaScript');
	process.exit(1);
}

console.log('📝 Generating type declarations...');
const declarations = Bun.spawnSync(
	[
		process.execPath,
		'x',
		'tsc',
		'--project',
		'tsconfig.json',
		'--emitDeclarationOnly',
		'--declaration',
		'--declarationMap',
		'--outDir',
		'dist',
		'--rootDir',
		'src',
		'--noEmit',
		'false',
	],
	{
		cwd: packageDir,
		stdout: 'inherit',
		stderr: 'inherit',
	},
);

if (!declarations.success) {
	console.error('❌ Failed to generate type declarations');
	process.exit(1);
}

console.log('🔤 Copying fonts...');
mkdirSync(fontsDistDir, { recursive: true });
for (const file of readdirSync(fontsSrcDir)) {
	if (!file.endsWith('.woff2')) continue;
	copyFileSync(join(fontsSrcDir, file), join(fontsDistDir, file));
}

console.log('\n✅ Build complete!');
console.log(`   Package: ${distDir}`);
