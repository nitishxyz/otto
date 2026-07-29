// Cloudflare Worker handler to serve the install.sh file.
// We import the script as base64 to avoid triggering Cloudflare's upload scanner.

// @ts-expect-error - esbuild base64 loader returns a string at runtime
import SCRIPT from '../../scripts/install.sh';

const INSTALLER = Uint8Array.from(atob(SCRIPT), (character) =>
	character.charCodeAt(0),
);

export default {
	async fetch(_req: Request): Promise<Response> {
		return new Response(INSTALLER, {
			headers: {
				'content-type': 'text/plain; charset=utf-8',
				'cache-control': 'public, max-age=300',
			},
		});
	},
};
