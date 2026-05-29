#!/usr/bin/env bun
import { $ } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CANVAS_DIR = join(ROOT, 'apps/canvas');
const ENV_FILE = join(ROOT, '.env.desktop-signing');
const ENTITLEMENTS = join(CANVAS_DIR, 'src-tauri/resources/entitlements.plist');
const GHOSTTY_STAGED_DIR = join(CANVAS_DIR, 'src-tauri/resources/ghostty');
const GHOSTTY_LIB_DIR = join(GHOSTTY_STAGED_DIR, 'lib');
const GHOSTTY_DYLIB = join(GHOSTTY_LIB_DIR, 'libghostty-vt.dylib');

function loadSigningEnv(): string | null {
	if (!existsSync(ENV_FILE)) return process.env.APPLE_SIGNING_IDENTITY || null;

	const content = readFileSync(ENV_FILE, 'utf8');
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) continue;
		const key = trimmed.slice(0, eqIndex).trim();
		let value = trimmed.slice(eqIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		process.env[key] = value;
	}

	return process.env.APPLE_SIGNING_IDENTITY || null;
}

function parseArgs() {
	const args = process.argv.slice(2);
	let devMode = false;
	let sign = false;
	let skipCli = false;
	let skipGhostty = false;
	let platformArg: string | undefined;
	let targetArg: string | undefined;
	let ghosttySourceArg: string | undefined;
	let optimizeArg: string | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--dev') {
			devMode = true;
			continue;
		}
		if (arg === '--sign') {
			sign = true;
			continue;
		}
		if (arg === '--skip-cli') {
			skipCli = true;
			continue;
		}
		if (arg === '--skip-ghostty') {
			skipGhostty = true;
			continue;
		}
		if (arg === '--platform') {
			platformArg = args[index + 1];
			index += 1;
			continue;
		}
		if (arg === '--target') {
			targetArg = args[index + 1];
			index += 1;
			continue;
		}
		if (arg === '--ghostty-source') {
			ghosttySourceArg = args[index + 1];
			index += 1;
			continue;
		}
		if (arg === '--optimize') {
			optimizeArg = args[index + 1];
			index += 1;
		}
	}

	return {
		devMode,
		ghosttySourceArg,
		optimizeArg,
		platformArg,
		sign,
		skipCli,
		skipGhostty,
		targetArg,
	};
}

async function codesignCanvasArtifact(path: string, withRuntime = false) {
	const identity = loadSigningEnv();
	if (!identity) {
		throw new Error(
			`Signing requires APPLE_SIGNING_IDENTITY. Set it in ${ENV_FILE} or env.`,
		);
	}

	if (withRuntime) {
		await $`codesign --force --options runtime --timestamp --sign ${identity} --entitlements ${ENTITLEMENTS} ${path}`;
		return;
	}

	await $`codesign --force --timestamp --sign ${identity} ${path}`;
}

async function signStagedCanvasResources() {
	if (process.platform !== 'darwin') {
		console.log('\nℹ️  Skipping codesign on non-macOS host.');
		return;
	}

	console.log('\n🔏 Signing staged canvas resources...');
	const binariesGlob = join(CANVAS_DIR, 'src-tauri/resources/binaries');
	await $`bash -lc 'for bin in "${binariesGlob}"/*; do [ -f "$bin" ] || continue; codesign --force --options runtime --timestamp --sign "$APPLE_SIGNING_IDENTITY" --entitlements "${ENTITLEMENTS}" "$bin"; done'`;

	if (existsSync(GHOSTTY_DYLIB)) {
		await codesignCanvasArtifact(GHOSTTY_DYLIB);
	}
}

async function prepareAssets(options: ReturnType<typeof parseArgs>) {
	const command = ['bun', 'run', 'scripts/prepare-canvas.ts'];
	if (options.platformArg) {
		command.push('--platform', options.platformArg);
	}
	if (options.targetArg) {
		command.push('--target', options.targetArg);
	}
	if (options.ghosttySourceArg) {
		command.push('--ghostty-source', options.ghosttySourceArg);
	}
	if (options.optimizeArg) {
		command.push('--optimize', options.optimizeArg);
	}
	if (options.skipCli) {
		command.push('--skip-cli');
	}
	if (options.skipGhostty) {
		command.push('--skip-ghostty');
	}

	const prepareProcess = Bun.spawn({
		cmd: command,
		cwd: ROOT,
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit',
	});
	const exitCode = await prepareProcess.exited;
	if (exitCode !== 0) {
		throw new Error(`prepare-canvas.ts failed with exit code ${exitCode}`);
	}
}

function applyCanvasRuntimeEnv() {
	if (existsSync(GHOSTTY_LIB_DIR)) {
		process.env.OTTO_CANVAS_LIBGHOSTTY_VT_LIB_DIR = GHOSTTY_LIB_DIR;
	}
}

async function buildCanvasApp(options: ReturnType<typeof parseArgs>) {
	applyCanvasRuntimeEnv();
	process.chdir(CANVAS_DIR);

	if (options.devMode) {
		if (options.targetArg) {
			await $`bun run tauri dev --target ${options.targetArg}`;
			return;
		}
		await $`bun run tauri dev`;
		return;
	}

	if (options.targetArg) {
		await $`bun run tauri build --target ${options.targetArg}`;
		return;
	}
	await $`bun run tauri build`;
}

async function main() {
	const options = parseArgs();

	console.log('🎨 otto canvas Build Script');
	console.log('==========================');
	if (options.sign) {
		console.log('🔏 Code signing enabled');
	}

	await prepareAssets(options);
	if (options.sign) {
		loadSigningEnv();
		await signStagedCanvasResources();
	}
	await buildCanvasApp(options);

	console.log('\n✅ Canvas build complete!');
	if (!options.devMode) {
		console.log('\n📦 Output locations:');
		console.log(
			'   macOS DMG:    apps/canvas/src-tauri/target/release/bundle/dmg/',
		);
		console.log(
			'   macOS App:    apps/canvas/src-tauri/target/release/bundle/macos/',
		);
		console.log(
			'   Windows MSI:  apps/canvas/src-tauri/target/release/bundle/msi/',
		);
		console.log(
			'   Linux:        apps/canvas/src-tauri/target/release/bundle/appimage/',
		);
	}
}

await main();
