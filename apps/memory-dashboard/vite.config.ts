import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(
	process.env.OTTO_MEMORY_DASHBOARD_PORT ??
		process.env.MEMORY_DASHBOARD_PORT ??
		9200,
);
const apiTarget = `http://127.0.0.1:${Number.isFinite(apiPort) ? apiPort : 9200}`;

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],
	base: './',
	server: {
		port: 5180,
		proxy: {
			'/api': {
				target: apiTarget,
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		chunkSizeWarningLimit: 600,
	},
});
