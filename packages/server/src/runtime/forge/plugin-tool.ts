import {
	executeNativePluginTool,
	pluginManifestSchema,
	pluginNameSchema,
	pluginToolSchema,
	validateNativePlugin,
	type PluginTool,
} from '@ottocode/sdk';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { getAllAgentDetails } from '../agent/config-management.ts';
import type { ForgeInput, ForgePlan, ForgeScope } from './types.ts';
import {
	assertForgePluginMutable,
	atomicWriteForgeJson,
	resetForgePluginRuntime,
	resolveForgePlugin,
} from './plugin.ts';

function toolIdentity(input: ForgeInput): { plugin: string; toolName: string } {
	const plugin = input.plugin?.trim().toLowerCase();
	const toolName = (input.toolName ?? input.name)?.trim();
	if (!plugin) throw new Error('plugin is required for plugin-tool actions');
	if (!pluginNameSchema.safeParse(plugin).success) {
		throw new Error(`Invalid plugin name '${plugin}'`);
	}
	if (!toolName)
		throw new Error('toolName is required for plugin-tool actions');
	if (!pluginNameSchema.safeParse(toolName).success) {
		throw new Error(`Invalid native tool name '${toolName}'`);
	}
	return { plugin, toolName };
}

function resolveEntry(pluginDir: string, entry: string): string {
	const root = resolve(pluginDir);
	const path = resolve(root, entry);
	if (path !== root && !path.startsWith(`${root}${sep}`)) {
		throw new Error(`Tool entry escapes plugin directory: ${entry}`);
	}
	return path;
}

function buildToolDefinition(
	input: ForgeInput,
	toolName: string,
	existing?: PluginTool,
): PluginTool {
	const entry =
		input.entry?.trim() || existing?.entry || `tools/${toolName}.ts`;
	const description = input.description?.trim() || existing?.description;
	if (!description)
		throw new Error('description is required for a native tool');
	const inputSchema = input.inputSchema ?? existing?.inputSchema;
	if (!inputSchema)
		throw new Error('inputSchema is required for a native tool');
	return pluginToolSchema.parse({
		name: toolName,
		entry,
		description,
		inputSchema,
		...(input.outputSchema !== undefined || existing?.outputSchema !== undefined
			? { outputSchema: input.outputSchema ?? existing?.outputSchema }
			: {}),
		effects: input.effects ?? existing?.effects ?? [],
		secrets: input.secrets ?? existing?.secrets ?? [],
		timeoutMs: input.timeoutMs ?? existing?.timeoutMs ?? 120_000,
	});
}

async function toolImpacts(
	projectRoot: string,
	fullName: string,
): Promise<string[]> {
	const agents = (await getAllAgentDetails(projectRoot)).agents
		.filter((agent) =>
			[...agent.toolConfig.firstClass, ...agent.toolConfig.loadable].includes(
				fullName,
			),
		)
		.map((agent) => agent.name);
	return agents.length ? [`Referenced by agents: ${agents.join(', ')}`] : [];
}

async function executeTool(
	projectRoot: string,
	pluginDir: string,
	toolName: string,
	input: Record<string, unknown>,
) {
	const stream = await executeNativePluginTool({
		pluginDir,
		projectRoot,
		toolName,
		input,
	});
	const deltas: Array<{ channel: string; delta: string }> = [];
	let result: unknown;
	for await (const chunk of stream) {
		if ('result' in chunk) result = chunk.result;
		else deltas.push(chunk);
	}
	return { result, deltas };
}

export async function runForgePluginToolAction(
	projectRoot: string,
	input: ForgeInput,
) {
	const { plugin: pluginName, toolName } = toolIdentity(input);
	const scope: ForgeScope = input.scope ?? 'project';
	const plugin = await resolveForgePlugin(projectRoot, pluginName, scope);
	if (!plugin.manifest) throw new Error(`Plugin '${pluginName}' is invalid`);
	const existing = plugin.manifest.tools?.find(
		(tool) => tool.name === toolName,
	);

	if (input.action === 'status') {
		if (!existing)
			throw new Error(`Native tool '${pluginName}__${toolName}' not found`);
		return {
			ok: true,
			tool: {
				plugin: pluginName,
				...existing,
				fullName: `${pluginName}__${toolName}`,
			},
		};
	}
	if (input.action === 'validate') {
		const validation = await validateNativePlugin(plugin.dir);
		return {
			ok: validation.ok && Boolean(existing),
			toolName,
			validation,
			...(!existing
				? { error: `Native tool '${pluginName}__${toolName}' not found` }
				: {}),
		};
	}
	if (input.action === 'execute') {
		if (!existing)
			throw new Error(`Native tool '${pluginName}__${toolName}' not found`);
		return {
			ok: true,
			execution: await executeTool(
				projectRoot,
				plugin.dir,
				toolName,
				input.toolInput ?? {},
			),
		};
	}

	const action = input.action === 'plan' ? input.targetAction : input.action;
	if (!action || !['create', 'update', 'remove'].includes(action)) {
		throw new Error(
			`Action '${input.action}' is not supported for plugin-tool`,
		);
	}
	if (action === 'create' && existing) {
		throw new Error(
			`Native tool '${pluginName}__${toolName}' already exists; use update`,
		);
	}
	if ((action === 'update' || action === 'remove') && !existing) {
		throw new Error(`Native tool '${pluginName}__${toolName}' not found`);
	}
	assertForgePluginMutable(plugin);

	const definition =
		action === 'remove'
			? undefined
			: buildToolDefinition(input, toolName, existing);
	const entry = definition?.entry ?? existing?.entry;
	const entryPath = entry ? resolveEntry(plugin.dir, entry) : undefined;
	const impacts =
		action === 'remove'
			? await toolImpacts(projectRoot, `${pluginName}__${toolName}`)
			: [];
	const plan: ForgePlan = {
		action: action as 'create' | 'update' | 'remove',
		target: {
			kind: 'plugin-tool',
			scope,
			name: `${pluginName}/${toolName}`,
			paths: [plugin.manifestPath, ...(entryPath ? [entryPath] : [])],
		},
		exists: Boolean(existing),
		changes: [
			`${action} native tool '${pluginName}__${toolName}'`,
			...impacts.map((impact) => `Affected: ${impact}`),
		],
		...(definition ? { preview: JSON.stringify(definition, null, 2) } : {}),
	};
	if (input.action === 'plan' || input.dryRun) {
		return { ok: true, applied: false, plan };
	}

	const rawManifest = JSON.parse(
		await readFile(plugin.manifestPath, 'utf8'),
	) as Record<string, unknown>;
	const originalManifest = await readFile(plugin.manifestPath, 'utf8');
	const originalEntry = entryPath
		? await readFile(entryPath, 'utf8').catch(() => null)
		: null;
	const tools = [...(plugin.manifest.tools ?? [])].filter(
		(tool) => tool.name !== toolName,
	);
	if (definition) tools.push(definition);
	const nextManifest: Record<string, unknown> = { ...rawManifest };
	if (tools.length) nextManifest.tools = tools;
	else delete nextManifest.tools;
	pluginManifestSchema.parse(nextManifest);

	try {
		if (definition && entryPath) {
			const source = input.content ?? originalEntry;
			if (!source)
				throw new Error('content is required to create a native tool');
			await mkdir(dirname(entryPath), { recursive: true });
			await writeFile(entryPath, source, 'utf8');
		}
		await atomicWriteForgeJson(plugin.manifestPath, nextManifest);
		const validation = await validateNativePlugin(plugin.dir);
		if (!validation.ok) throw new Error(validation.errors.join('\n'));
	} catch (error) {
		await writeFile(plugin.manifestPath, originalManifest, 'utf8');
		if (entryPath) {
			if (originalEntry === null) await rm(entryPath, { force: true });
			else await writeFile(entryPath, originalEntry, 'utf8');
		}
		throw error;
	}

	if (action === 'remove' && entryPath) {
		const shared = tools.some((tool) => tool.entry === entry);
		if (!shared) await rm(entryPath, { force: true });
	}
	if (
		action === 'update' &&
		existing?.entry &&
		definition?.entry !== existing.entry
	) {
		const oldPath = resolveEntry(plugin.dir, existing.entry);
		const shared = tools.some((tool) => tool.entry === existing.entry);
		if (!shared) await rm(oldPath, { force: true });
	}
	resetForgePluginRuntime(projectRoot, scope);
	return {
		ok: true,
		applied: true,
		plan,
		tool: definition,
		impacts,
	};
}
