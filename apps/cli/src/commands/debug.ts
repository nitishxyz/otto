import {
	getGlobalDebugLogPath,
	readDebugConfig,
	writeDebugConfig,
} from '@ottocode/sdk';

function parseScopes(rawScopes: string[]): string[] {
	return rawScopes
		.flatMap((value) => value.split(','))
		.map((value) => value.trim())
		.filter(Boolean);
}

export async function enableDebug(scopes: string[] = []) {
	const nextScopes = parseScopes(scopes);
	await writeDebugConfig({ enabled: true, scopes: nextScopes });
	const config = await readDebugConfig();
	console.log('Debug logging enabled');
	console.log(`Log file: ${config.logPath}`);
	console.log(
		`Scopes: ${config.scopes.length > 0 ? config.scopes.join(', ') : 'all'}`,
	);
}

export async function disableDebug() {
	await writeDebugConfig({ enabled: false, scopes: [] });
	console.log('Debug logging disabled');
}

export async function showDebugStatus() {
	const config = await readDebugConfig();
	console.log(`Enabled: ${config.enabled ? 'yes' : 'no'}`);
	console.log(`Log file: ${config.logPath}`);
	console.log(`Session logs: ${config.sessionsDir}`);
	console.log(
		`Scopes: ${config.scopes.length > 0 ? config.scopes.join(', ') : 'all'}`,
	);
}

export function printDebugPath() {
	console.log(getGlobalDebugLogPath());
}

export { registerDebugCommand } from './lazy/debug.ts';
