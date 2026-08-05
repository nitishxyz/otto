import { access } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { jsonSchema, tool, type JSONValue, type Tool } from 'ai';
import {
	resolveEffectivePlugins,
	type PluginTool,
} from '../../../../plugins/index.ts';
import { getProjectStateDir } from '../../../../config/src/paths.ts';
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
	storagePath: string;
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
		toModelOutput({ output }) {
			return toNativeToolModelOutput(output);
		},
		execute(input, options) {
			const secrets: Record<string, string> = {};
			for (const secret of args.definition.secrets) {
				const value = process.env[secret.env];
				if (!value && secret.required) {
					throw new Error(
						`Native tool ${name} requires secret ${secret.name} from ${secret.env}`,
					);
				}
				if (value) secrets[secret.name] = value;
			}
			return executeNativeExtension({
				entryPath: args.definition.entry,
				pluginDir: args.pluginDir,
				projectRoot: args.projectRoot,
				storagePath: args.storagePath,
				toolName: name,
				input,
				secrets,
				outputSchema: args.definition.outputSchema,
				timeoutMs: args.definition.timeoutMs,
				signal: options.abortSignal,
			});
		},
	});
	setToolMetadata(wrapped, metadata);
	return { name, tool: wrapped, metadata };
}

function toJsonValue(value: unknown): JSONValue {
	if (value === undefined) return null;
	return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function toNativeToolModelOutput(output: unknown) {
	if (!output || typeof output !== 'object' || !('content' in output)) {
		return { type: 'json' as const, value: toJsonValue(output) };
	}
	const result = output as {
		content?: Array<{
			type?: string;
			text?: string;
			value?: unknown;
			data?: string;
			mediaType?: string;
		}>;
		structuredContent?: unknown;
	};
	if (!Array.isArray(result.content)) {
		return { type: 'json' as const, value: toJsonValue(output) };
	}
	const value: Array<
		| { type: 'text'; text: string }
		| { type: 'image-data'; data: string; mediaType: string }
	> = [];
	for (const part of result.content) {
		if (part.type === 'text' && typeof part.text === 'string') {
			value.push({ type: 'text', text: part.text });
		} else if (part.type === 'json') {
			value.push({ type: 'text', text: JSON.stringify(part.value, null, 2) });
		} else if (
			part.type === 'image' &&
			typeof part.data === 'string' &&
			typeof part.mediaType === 'string'
		) {
			value.push({
				type: 'image-data',
				data: part.data,
				mediaType: part.mediaType,
			});
		}
	}
	if (result.structuredContent !== undefined) {
		value.unshift({
			type: 'text',
			text: JSON.stringify(result.structuredContent, null, 2),
		});
	}
	return value.length > 0
		? { type: 'content' as const, value }
		: { type: 'json' as const, value: toJsonValue(output) };
}

export async function discoverNativeExtensionTools(
	projectRoot: string,
): Promise<NativeExtensionTool[]> {
	const effective = await resolveEffectivePlugins(projectRoot);
	const projectStateDir = await getProjectStateDir(projectRoot);
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
					storagePath: join(projectStateDir, 'plugins', plugin.name, 'storage'),
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
