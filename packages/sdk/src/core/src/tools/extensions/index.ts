import { access } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { jsonSchema, tool, type Tool } from 'ai';
import {
	resolveEffectivePlugins,
	type PluginTool,
} from '../../../../plugins/index.ts';
import { logger } from '../../utils/logger.ts';
import { setToolMetadata, type ToolMetadata } from '../metadata.ts';
import { executeNativeExtension } from './client.ts';

export type NativeExtensionTool = {
	name: string;
	tool: Tool;
	metadata: ToolMetadata;
};

function normalizeToolName(value: string): string {
	const normalized = value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
	return normalized || 'tool';
}

export function getNativeExtensionToolName(
	pluginName: string,
	toolName: string,
): string {
	return normalizeToolName(`${pluginName}__${toolName}`);
}

function resolvePluginEntry(pluginDir: string, entry: string): string {
	const normalizedPluginDir = resolve(pluginDir);
	const entryPath = resolve(normalizedPluginDir, entry);
	if (
		entryPath !== normalizedPluginDir &&
		!entryPath.startsWith(`${normalizedPluginDir}${sep}`)
	) {
		throw new Error(`Native tool entry escapes plugin directory: ${entry}`);
	}
	return entryPath;
}

async function entryExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function buildTool(args: {
	projectRoot: string;
	pluginDir: string;
	pluginName: string;
	pluginVersion: string;
	definition: PluginTool;
}): NativeExtensionTool {
	const name = getNativeExtensionToolName(
		args.pluginName,
		args.definition.name,
	);
	const metadata: ToolMetadata = {
		source: 'extension',
		plugin: args.pluginName,
		version: args.pluginVersion,
		activation: 'loadable',
		effects: args.definition.effects,
	};
	const wrapped = tool({
		description: args.definition.description,
		inputSchema: jsonSchema<Record<string, unknown>>(
			args.definition.inputSchema,
		),
		async execute(input, options) {
			return executeNativeExtension({
				entryPath: args.definition.entry,
				pluginDir: args.pluginDir,
				projectRoot: args.projectRoot,
				toolName: name,
				input,
				timeoutMs: args.definition.timeoutMs,
				signal: options.abortSignal,
			});
		},
	});
	setToolMetadata(wrapped, metadata);
	return { name, tool: wrapped, metadata };
}

export async function discoverNativeExtensionTools(
	projectRoot: string,
): Promise<NativeExtensionTool[]> {
	const effective = await resolveEffectivePlugins(projectRoot);
	const tools: NativeExtensionTool[] = [];
	const names = new Set<string>();

	for (const plugin of effective.plugins) {
		if (
			!plugin.enabled ||
			plugin.status !== 'installed' ||
			!plugin.manifest?.tools?.length
		) {
			continue;
		}
		if (
			plugin.manifest.platforms?.length &&
			!plugin.manifest.platforms.includes(
				process.platform as 'darwin' | 'linux' | 'win32',
			)
		) {
			continue;
		}

		for (const definition of plugin.manifest.tools) {
			const name = getNativeExtensionToolName(plugin.name, definition.name);
			if (names.has(name)) {
				logger.warn(`Skipping duplicate native extension tool: ${name}`);
				continue;
			}
			const entryPath = resolvePluginEntry(plugin.dir, definition.entry);
			if (!(await entryExists(entryPath))) {
				logger.warn(
					`Skipping native extension tool ${name}: missing ${definition.entry}`,
				);
				continue;
			}
			names.add(name);
			tools.push(
				buildTool({
					projectRoot,
					pluginDir: plugin.dir,
					pluginName: plugin.name,
					pluginVersion: plugin.manifest.version,
					definition,
				}),
			);
		}
	}

	return tools;
}
