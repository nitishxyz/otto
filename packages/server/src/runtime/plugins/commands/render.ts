import type { PluginCommand } from '@ottocode/sdk';
import { resolve } from 'node:path';
import type {
	RenderPluginCommandOptions,
	RenderedPluginCommand,
	RenderedPluginCommandSpec,
} from './types.ts';

const PLACEHOLDER_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function isPathInsidePluginDir(
	pluginDir: string,
	candidatePath: string,
): boolean {
	const resolvedPluginDir = resolve(pluginDir);
	const resolvedPath = resolve(candidatePath);
	return (
		resolvedPath === resolvedPluginDir ||
		resolvedPath.startsWith(`${resolvedPluginDir}/`)
	);
}

export function renderPluginCommand(
	definition: PluginCommand,
	values: Record<string, string | number | boolean>,
	options: RenderPluginCommandOptions,
): RenderedPluginCommand {
	const primary = renderPluginCommandSpec(definition, values, options);
	if (!primary.ok) return primary;

	const rendered: Extract<RenderedPluginCommand, { ok: true }> = {
		ok: true,
		primary: primary.value,
	};

	if (definition.fallback) {
		const fallback = renderPluginCommandSpec(
			definition.fallback,
			values,
			options,
		);
		if (!fallback.ok) return fallback;
		rendered.fallback = fallback.value;
	}

	return rendered;
}

function renderPluginCommandSpec(
	definition: PluginCommand,
	values: Record<string, string | number | boolean>,
	options: RenderPluginCommandOptions,
):
	| { ok: true; value: RenderedPluginCommandSpec }
	| { ok: false; error: string } {
	if (PLACEHOLDER_PATTERN.test(definition.command)) {
		return {
			ok: false,
			error: 'Plugin command executable cannot use template placeholders',
		};
	}

	const args = renderTemplateArgs(definition.args ?? [], values);
	if (!args.ok) return args;

	const env = renderTemplateRecord(definition.env, values);
	if (!env.ok) return env;

	const cwd = renderWorkingDirectory(options.pluginDir, definition.cwd, values);
	if (!cwd.ok) return cwd;

	return {
		ok: true,
		value: {
			command: definition.command,
			args: [...args.value, ...(options.extraArgs ?? [])],
			env: env.value,
			cwd: cwd.value,
		},
	};
}

function renderTemplateArgs(
	args: string[],
	values: Record<string, string | number | boolean>,
): { ok: true; value: string[] } | { ok: false; error: string } {
	const rendered: string[] = [];
	for (const arg of args) {
		const interpolated = interpolateTemplate(arg, values);
		if (!interpolated.ok) return interpolated;
		rendered.push(interpolated.value);
	}
	return { ok: true, value: rendered };
}

function renderTemplateRecord(
	record: Record<string, string> | undefined,
	values: Record<string, string | number | boolean>,
):
	| { ok: true; value: Record<string, string> | undefined }
	| { ok: false; error: string } {
	if (!record) return { ok: true, value: undefined };

	const rendered: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		const interpolated = interpolateTemplate(value, values);
		if (!interpolated.ok) return interpolated;
		rendered[key] = interpolated.value;
	}
	return { ok: true, value: rendered };
}

function renderWorkingDirectory(
	pluginDir: string,
	cwdTemplate: string | undefined,
	values: Record<string, string | number | boolean>,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
	if (!cwdTemplate?.trim()) return { ok: true, value: undefined };

	const interpolated = interpolateTemplate(cwdTemplate, values);
	if (!interpolated.ok) return interpolated;

	const resolved = resolve(pluginDir, interpolated.value);
	if (!isPathInsidePluginDir(pluginDir, resolved)) {
		return {
			ok: false,
			error: 'Plugin command cwd must stay inside the plugin directory',
		};
	}

	return { ok: true, value: resolved };
}

function interpolateTemplate(
	template: string,
	values: Record<string, string | number | boolean>,
): { ok: true; value: string } | { ok: false; error: string } {
	const unresolved = new Set<string>();
	const rendered = template.replace(
		PLACEHOLDER_PATTERN,
		(match, key: string) => {
			if (!(key in values)) {
				unresolved.add(key);
				return match;
			}
			return String(values[key]);
		},
	);

	if (unresolved.size > 0) {
		const missing = Array.from(unresolved).sort().join(', ');
		return {
			ok: false,
			error: `Missing required placeholder: ${missing}`,
		};
	}

	return { ok: true, value: rendered };
}
