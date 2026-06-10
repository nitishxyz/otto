#!/usr/bin/env bun
/**
 * Build Windows Desktop App (Tauri + CLI binary)
 *
 * This script handles building the otto desktop app for Windows.
 * It can run natively on Windows or cross-compile the CLI portion from macOS/Linux.
 *
 * For the full Tauri desktop app (MSI/NSIS installer), you need either:
 *   1. A Windows machine (native or VM)
 *   2. GitHub Actions with windows-latest runner (see .github/workflows/release.yml)
 *
 * The CLI binary itself can be cross-compiled from any OS via Bun's --target flag.
 *
 * Usage:
 *   bun run scripts/build-windows-desktop.ts              # Build CLI + Tauri (Windows only)
 *   bun run scripts/build-windows-desktop.ts --cli-only   # Cross-compile CLI binary only (any OS)
 *   bun run scripts/build-windows-desktop.ts --verbose    # Show build output
 */

import { $ } from 'bun';
import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CLI_DIR = join(ROOT, 'apps/cli');
const DESKTOP_DIR = join(ROOT, 'apps/desktop');
const BINARIES_DIR = join(DESKTOP_DIR, 'src-tauri/resources/binaries');

const cliOnly = process.argv.includes('--cli-only');
const isWindows = process.platform === 'win32';

async function buildWindowsCliBinary(): Promise<string> {
	console.log('\n📦 Building CLI binary for windows-x64...');

	await $`cd ${CLI_DIR} && bun run prebuild`;

	const outfile = join(CLI_DIR, 'dist', 'otto-windows-x64.exe');
	mkdirSync(join(CLI_DIR, 'dist'), { recursive: true });

	await $`cd ${CLI_DIR} && bun build --compile --minify --define FFF_LIBC='"gnu"' --target=bun-windows-x64 ./index.ts --outfile ${outfile}`;

	console.log(`   ✅ Built ${outfile}`);
	return outfile;
}

async function copyBinaryToDesktop(binaryPath: string): Promise<string> {
	console.log('\n📋 Copying binary to desktop resources...');

	mkdirSync(BINARIES_DIR, { recursive: true });

	const destPath = join(BINARIES_DIR, 'otto-windows-x64.exe');
	copyFileSync(binaryPath, destPath);

	console.log(`   ✅ Copied to ${destPath}`);
	return destPath;
}

async function buildTauriApp() {
	if (!isWindows) {
		console.error(
			'\n❌ Tauri desktop build requires Windows. Use --cli-only to cross-compile the CLI binary.',
		);
		console.error(
			'   For full desktop builds, use GitHub Actions (windows-latest runner) or a Windows VM.',
		);
		process.exit(1);
	}

	console.log('\n🖥️  Building Tauri desktop app for Windows...');
	process.chdir(DESKTOP_DIR);
	await $`bun run tauri build`;
}

async function main() {
	console.log('🚀 otto Windows Desktop Build');
	console.log('=============================');

	if (cliOnly) {
		console.log('Mode: CLI binary only (cross-compile)');
	} else if (isWindows) {
		console.log('Mode: Full desktop build (CLI + Tauri MSI/NSIS)');
	} else {
		console.log('Mode: CLI binary only (not on Windows)');
		console.log(
			'   Tip: Use GitHub Actions or a Windows VM for full Tauri builds.',
		);
	}

	try {
		const binaryPath = await buildWindowsCliBinary();

		if (!cliOnly) {
			await copyBinaryToDesktop(binaryPath);

			if (isWindows) {
				await buildTauriApp();

				console.log('\n✅ Build complete!');
				console.log('\n📦 Output locations:');
				console.log(
					'   MSI:  apps/desktop/src-tauri/target/release/bundle/msi/',
				);
				console.log(
					'   NSIS: apps/desktop/src-tauri/target/release/bundle/nsis/',
				);
			} else {
				console.log('\n✅ CLI binary built and copied to desktop resources.');
				console.log(
					'   Run `bun run tauri build` on Windows to complete the desktop build.',
				);
			}
		} else {
			console.log('\n✅ Windows CLI binary ready!');
			console.log(`   Output: ${binaryPath}`);
		}
	} catch (error) {
		console.error('\n❌ Build failed:', error);
		process.exit(1);
	}
}

main();
