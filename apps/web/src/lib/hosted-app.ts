export function isHostedApp(): boolean {
	return import.meta.env.VITE_HOSTED_APP === 'true';
}
