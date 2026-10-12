import type { MCPServerConfig, PluginCommand } from '@ottocode/sdk';

export const REDACTED = '<redacted>';

function redactValues(
	record: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!record) return undefined;
	return Object.fromEntries(Object.keys(record).map((key) => [key, REDACTED]));
}

/** Removes embedded credentials (userinfo and secret-looking query values). */
export function redactUrl(url: string | undefined): string | undefined {
	if (!url) return url;
	try {
		const parsed = new URL(url);
		if (parsed.username) parsed.username = REDACTED;
		if (parsed.password) parsed.password = REDACTED;
		for (const key of Array.from(parsed.searchParams.keys())) {
			if (/token|key|secret|password|auth|signature|sig/i.test(key)) {
				parsed.searchParams.set(key, REDACTED);
			}
		}
		return parsed.toString();
	} catch {
		return url;
	}
}

/** Preview-safe MCP server config: env/header values and URL credentials hidden. */
export function redactMCPServerConfig(
	server: MCPServerConfig,
): MCPServerConfig {
	const env = redactValues(server.env);
	const headers = redactValues(server.headers);
	return {
		...server,
		...(env ? { env } : {}),
		...(headers ? { headers } : {}),
		...(server.url ? { url: redactUrl(server.url) } : {}),
	};
}

/** Preview-safe plugin command, including every fallback in the chain. */
export function redactPluginCommand(command: PluginCommand): PluginCommand {
	const env = redactValues(command.env);
	return {
		...command,
		...(env ? { env } : {}),
		...(command.fallback
			? { fallback: redactPluginCommand(command.fallback) }
			: {}),
	};
}
