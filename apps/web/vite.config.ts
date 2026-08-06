import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
	plugins: [TanStackRouterVite() as PluginOption, react()],
	server: {
		watch: {
			// Watch the web-sdk source directory
			ignored: ['!**/packages/web-sdk/**'],
		},
	},
	optimizeDeps: {
		// EXCLUDE web-sdk from pre-bundling so changes are picked up immediately
		exclude: ['@ottocode/web-sdk'],
	},
	worker: {
		// The Pierre highlighting worker is an ES module and is instantiated with
		// `{ type: 'module' }`; the default `iife` format cannot code-split it.
		format: 'es',
	},
	resolve: {
		alias: {
			// Some transitive deps still import the pre-v2 noble/ciphers subpath.
			'@noble/ciphers/aes': '@noble/ciphers/aes.js',
			// Resolve workspace packages to their source instead of dist
			'@ottocode/web-sdk': path.resolve(
				__dirname,
				'../../packages/web-sdk/src',
			),
		},
		// Deduplicate React and React-DOM to prevent multiple instances
		dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (
						id.includes('react-syntax-highlighter') ||
						id.includes('refractor') ||
						id.includes('prismjs')
					) {
						return 'syntax';
					}
					if (
						id.includes('react-markdown') ||
						id.includes('remark') ||
						id.includes('rehype') ||
						id.includes('unified') ||
						id.includes('mdast') ||
						id.includes('hast') ||
						id.includes('micromark')
					) {
						return 'markdown';
					}
					if (
						id.includes('node_modules/react/') ||
						id.includes('node_modules/react-dom/') ||
						id.includes('scheduler') ||
						id.includes('@tanstack')
					) {
						return 'framework';
					}
					if (id.includes('lucide-react')) {
						return 'icons';
					}
				},
			},
		},
		chunkSizeWarningLimit: 500,
	},
});
