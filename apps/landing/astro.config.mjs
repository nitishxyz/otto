import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
	site: 'https://ottocode.io',
	output: 'static',
	adapter: cloudflare({
		configPath: process.env.SST_WRANGLER_PATH,
	}),
	integrations: [react(), tailwind(), sitemap()],
	vite: {
		plugins: [
			{
				name: 'landing-cloudflare-server-dependencies',
				configEnvironment(environmentName) {
					if (!['astro', 'ssr', 'prerender'].includes(environmentName)) {
						return;
					}

					return {
						optimizeDeps: {
							include: [
								'@astrojs/react > @astrojs/internal-helpers > picomatch',
							],
						},
					};
				},
			},
		],
	},
	server: { port: 4000 },
});
