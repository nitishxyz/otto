import { domains } from './domains';

// Cloudflare Worker to serve the install script
export const script = new sst.cloudflare.Worker('OttoIo', {
	domain: domains.sh,
	handler: 'infra/handlers/install-worker.ts',
	build: {
		loader: {
			'.sh': 'base64',
		},
	},
	url: true,
});
