import { access } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import Ajv from 'ajv';
import {
	pluginManifestSchema,
	type PluginManifest,
} from '../../../../plugins/schema.ts';
import { getProjectStateDir } from '../../../../config/src/paths.ts';
import { executeNativeExtension } from './client.ts';
import { getNativeExtensionToolName } from './index.ts';
import { collectNativeExtensionSecrets } from './secrets.ts';

export type NativePluginValidation = {
	ok: boolean;
	manifest?: PluginManifest;
	errors: string[];
};

function resolvePluginEntry(pluginDir: string, entry: string): string {
	const root = resolve(pluginDir);
	const path = resolve(root, entry);
	if (path !== root && !path.startsWith(`${root}${sep}`)) {
		throw new Error(`Tool entry escapes plugin directory: ${entry}`);
	}
	return path;
}

export async function validateNativePlugin(
	pluginDir: string,
): Promise<NativePluginValidation> {
	const errors: string[] = [];
	let manifest: PluginManifest;
	try {
		manifest = pluginManifestSchema.parse(
			await Bun.file(join(pluginDir, 'otto.plugin.json')).json(),
		);
	} catch (error) {
		return {
			ok: false,
			errors: [error instanceof Error ? error.message : String(error)],
		};
	}

	const ajv = new Ajv({ allErrors: true, strict: false });
	const names = new Set<string>();
	for (const definition of manifest.tools ?? []) {
		if (names.has(definition.name)) {
			errors.push(`Duplicate native tool name: ${definition.name}`);
		}
		names.add(definition.name);
		try {
			await access(resolvePluginEntry(pluginDir, definition.entry));
		} catch {
			errors.push(`Missing native tool entry: ${definition.entry}`);
		}
		try {
			ajv.compile(definition.inputSchema);
		} catch (error) {
			errors.push(
				`Invalid inputSchema for ${definition.name}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (definition.outputSchema) {
			try {
				ajv.compile(definition.outputSchema);
			} catch (error) {
				errors.push(
					`Invalid outputSchema for ${definition.name}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	return { ok: errors.length === 0, manifest, errors };
}

export async function executeNativePluginTool(args: {
	pluginDir: string;
	projectRoot: string;
	toolName: string;
	input: Record<string, unknown>;
	signal?: AbortSignal;
}): Promise<
	AsyncIterable<{ delta: string; channel: string } | { result: unknown }>
> {
	const validation = await validateNativePlugin(args.pluginDir);
	if (!validation.ok || !validation.manifest) {
		throw new Error(validation.errors.join('\n') || 'Invalid native plugin');
	}
	const definition = validation.manifest.tools?.find(
		(tool) => tool.name === args.toolName,
	);
	if (!definition) {
		throw new Error(`Native tool not found: ${args.toolName}`);
	}
	const validateInput = new Ajv({ allErrors: true, strict: false }).compile(
		definition.inputSchema,
	);
	if (!validateInput(args.input)) {
		throw new Error(
			`Native tool input failed inputSchema: ${(validateInput.errors ?? [])
				.map(
					(error) =>
						`${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
				)
				.join('; ')}`,
		);
	}
	const nativeToolName = getNativeExtensionToolName(
		validation.manifest.name,
		definition.name,
	);
	const secrets = collectNativeExtensionSecrets(definition.secrets, {
		environment: process.env,
		toolName: nativeToolName,
	});
	const projectStateDir = await getProjectStateDir(args.projectRoot);
	return executeNativeExtension({
		entryPath: definition.entry,
		pluginDir: args.pluginDir,
		projectRoot: args.projectRoot,
		storagePath: join(
			projectStateDir,
			'plugins',
			validation.manifest.name,
			'storage',
		),
		toolName: nativeToolName,
		input: args.input,
		secrets,
		outputSchema: definition.outputSchema,
		timeoutMs: definition.timeoutMs,
		signal: args.signal,
	});
}
