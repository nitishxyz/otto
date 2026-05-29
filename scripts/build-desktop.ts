#!/usr/bin/env bun
/**
 * Build Desktop App
 *
 * Builds the CLI binary for the current platform and packages the Tauri desktop app.
 *
 * Usage:
 *   bun run scripts/build-desktop.ts [--dev] [--sign] [--all-platforms]
 *
 * Options:
 *   --dev            Build in dev mode (skip production build)
 *   --sign           Sign the CLI binary with hardened runtime (macOS only, requires .env.desktop-signing)
 *   --all-platforms  Build CLI binaries for all platforms (requires cross-compile setup)
 */

import { $ } from 'bun';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CLI_DIR = join(ROOT, 'apps/cli');
const DESKTOP_DIR = join(ROOT, 'apps/desktop');
const BINARIES_DIR = join(DESKTOP_DIR, 'src-tauri/resources/binaries');
const ENTITLEMENTS = join(
	DESKTOP_DIR,
	'src-tauri/resources/entitlements.plist',
);
const ENV_FILE = join(ROOT, '.env.desktop-signing');

const PLATFORMS = {
	'darwin-arm64': 'bun-darwin-arm64',
	'darwin-x64': 'bun-darwin-x64',
	'linux-x64': 'bun-linux-x64',
	'linux-arm64': 'bun-linux-arm64',
} as const;

function detectPlatform(): keyof typeof PLATFORMS {
	const os = process.platform;
	const arch = process.arch;

	if (os === 'darwin' && arch === 'arm64') return 'darwin-arm64';
	if (os === 'darwin' && arch === 'x64') return 'darwin-x64';
	if (os === 'linux' && arch === 'x64') return 'linux-x64';
	if (os === 'linux' && arch === 'arm64') return 'linux-arm64';

	throw new Error(`Unsupported platform: ${os}-${arch}`);
}

function loadSigningEnv(): string | null {
	if (!existsSync(ENV_FILE)) return null;

	const content = readFileSync(ENV_FILE, 'utf-8');
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIdx = trimmed.indexOf('=');
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		let value = trimmed.slice(eqIdx + 1).trim();
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

async function signBinary(binaryPath: string) {
	const identity = loadSigningEnv();
	if (!identity) {
		throw new Error(
			`Signing requires APPLE_SIGNING_IDENTITY. Set it in ${ENV_FILE} or env.`,
		);
	}

	console.log(`\n🔏 Signing binary with hardened runtime...`);
	console.log(`   Identity: ${identity}`);

	await $`codesign --force --options runtime --timestamp --sign ${identity} --entitlements ${ENTITLEMENTS} ${binaryPath}`;

	console.log(`   ✅ Binary signed`);
}

async function buildCliBinary(platform: keyof typeof PLATFORMS) {
	console.log(`\n📦 Building CLI binary for ${platform}...`);

	const target = PLATFORMS[platform];
	const outfile = join(CLI_DIR, 'dist', `otto-${platform}`);

	await $`cd ${CLI_DIR} && bun run ../../scripts/build-web.ts`;
	await $`cd ${CLI_DIR} && bun run ../../scripts/prepare-embedded-bins.ts ${platform}`;
	await $`cd ${CLI_DIR} && bun build --compile --minify --target=${target} ./index.ts --outfile ${outfile}`;

	return outfile;
}

async function copyBinaryToDesktop(binaryPath: string, platform: string) {
	console.log(`\n📋 Copying binary to desktop resources...`);

	if (!existsSync(BINARIES_DIR)) {
		mkdirSync(BINARIES_DIR, { recursive: true });
	}

	const destPath = join(BINARIES_DIR, `otto-${platform}`);
	copyFileSync(binaryPath, destPath);
	await $`chmod +x ${destPath}`;

	console.log(`   ✅ Copied to ${destPath}`);
	return destPath;
}

async function buildDesktopApp(devMode: boolean) {
	console.log(`\n🖥️  Building Tauri desktop app...`);

	process.chdir(DESKTOP_DIR);

	if (devMode) {
		await $`bun run tauri dev`;
	} else {
		await $`bun run tauri build`;
	}
}

async function main() {
	const args = process.argv.slice(2);
	const devMode = args.includes('--dev');
	const signBin = args.includes('--sign');
	const allPlatforms = args.includes('--all-platforms');

	console.log('🚀 otto desktop Build Script');
	console.log('===========================');
	if (signBin) {
		console.log('🔏 Code signing enabled');
	}

	try {
		if (allPlatforms) {
			for (const platform of Object.keys(
				PLATFORMS,
			) as (keyof typeof PLATFORMS)[]) {
				const binaryPath = await buildCliBinary(platform);
				const destPath = await copyBinaryToDesktop(binaryPath, platform);
				if (signBin && process.platform === 'darwin') {
					await signBinary(destPath);
				}
			}
		} else {
			const platform = detectPlatform();
			console.log(`\n🔍 Detected platform: ${platform}`);

			const binaryPath = await buildCliBinary(platform);
			const destPath = await copyBinaryToDesktop(binaryPath, platform);
			if (signBin && process.platform === 'darwin') {
				await signBinary(destPath);
			}
		}

		if (!devMode) {
			await buildDesktopApp(false);

			console.log('\n✅ Build complete!');
			console.log('\n📦 Output locations:');
			console.log(
				'   macOS DMG:    apps/desktop/src-tauri/target/release/bundle/dmg/',
			);
			console.log(
				'   macOS App:    apps/desktop/src-tauri/target/release/bundle/macos/',
			);
			console.log(
				'   Linux:        apps/desktop/src-tauri/target/release/bundle/appimage/',
			);
		} else {
			console.log('\n✅ Dev build ready! Starting dev server...');
			await buildDesktopApp(true);
		}
	} catch (error) {
		console.error('\n❌ Build failed:', error);
		process.exit(1);
	}
}

main();
