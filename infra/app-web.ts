import { domains } from './domains';
import { DEPLOYED_STAGES } from './utils';

export const appWeb = new sst.cloudflare.StaticSiteV2('AppWeb', {
	path: 'apps/web',
	build: {
		command: 'bun run build',
		output: 'dist',
	},
	notFound: 'single-page-application',
	domain: DEPLOYED_STAGES.includes($app.stage) ? domains.app : undefined,
	environment: {
		VITE_HOSTED_APP: DEPLOYED_STAGES.includes($app.stage) ? 'true' : 'false',
	},
	dev: {
		command: 'bun run dev',
		directory: 'apps/web',
	},
});
