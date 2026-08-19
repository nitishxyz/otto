import { pluginRegistrySchema } from './schema.ts';
import type {
	FetchPluginRegistryOptions,
	PluginRegistry,
	PluginRegistryEntry,
	ResolveRegistryPluginOptions,
} from './schema.ts';
import {
	DEFAULT_PLUGIN_REGISTRY_URL,
	isLocalSource,
	normalizeLocalSource,
} from './source.ts';

export async function fetchPluginRegistry(
	options: FetchPluginRegistryOptions = {},
): Promise<PluginRegistry> {
	const url = options.url ?? DEFAULT_PLUGIN_REGISTRY_URL;
	if (isLocalSource(url)) {
		const parsed = JSON.parse(await Bun.file(normalizeLocalSource(url)).text());
		return pluginRegistrySchema.parse(parsed);
	}

	const fetchImpl = options.fetch ?? fetch;
	const response = await fetchImpl(url);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch plugin registry ${url}: ${response.status}`,
		);
	}
	return pluginRegistrySchema.parse(await response.json());
}

/** Resolve a plugin name from configured registries. */
export async function resolveRegistryPlugin(
	name: string,
	options: ResolveRegistryPluginOptions = {},
): Promise<{ registryUrl: string; entry: PluginRegistryEntry }> {
	const registries = options.registries?.length
		? options.registries
		: [options.url ?? DEFAULT_PLUGIN_REGISTRY_URL];

	for (const registryUrl of registries) {
		const registry = await fetchPluginRegistry({
			url: registryUrl,
			fetch: options.fetch,
		});
		const entry = registry.plugins.find((plugin) => plugin.name === name);
		if (entry) return { registryUrl, entry };
	}

	throw new Error(`Plugin not found in registries: ${name}`);
}

/** Install a plugin from a registry name or local directory. */
