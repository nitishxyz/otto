import { client } from '@ottocode/api';

const DEFAULT_PORT = 9100;

let overridePort: number | null = null;

export function setPort(port: number) {
	overridePort = port;
}

export function getBaseUrl(): string {
	const port =
		overridePort ??
		(process.env.OTTO_PORT ? Number(process.env.OTTO_PORT) : DEFAULT_PORT);
	return `http://127.0.0.1:${port}`;
}

export function configureApi() {
	client.setConfig({
		baseURL: getBaseUrl(),
	});
}
