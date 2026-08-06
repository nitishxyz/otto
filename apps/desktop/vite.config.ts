import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'node:path';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [react()],
	base: './',

	worker: {
		// The Pierre highlighting worker is an ES module and is instantiated with
		// `{ type: 'module' }`; the default `iife` format cannot code-split it.
		format: 'es',
	},

	resolve: {
		alias: {
			'@ottocode/web-sdk/lib': path.resolve(
				__dirname,
				'../../packages/web-sdk/src/lib/index.ts',
			),
			'@ottocode/web-sdk/hooks': path.resolve(
				__dirname,
				'../../packages/web-sdk/src/hooks/index.ts',
			),
			'@ottocode/web-sdk/stores': path.resolve(
				__dirname,
				'../../packages/web-sdk/src/stores/index.ts',
			),
			'@ottocode/web-sdk/components': path.resolve(
				__dirname,
				'../../packages/web-sdk/src/components/index.ts',
			),
			'@ottocode/web-sdk': path.resolve(
				__dirname,
				'../../packages/web-sdk/src/index.ts',
			),
		},
	},

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: 'ws',
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ['**/src-tauri/**'],
		},
	},
}));
