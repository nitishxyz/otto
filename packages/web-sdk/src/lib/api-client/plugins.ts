import {
	disablePlugin as apiDisablePlugin,
	enablePlugin as apiEnablePlugin,
	installPlugin as apiInstallPlugin,
	listPluginCommands as apiListPluginCommands,
	listPluginRegistry as apiListPluginRegistry,
	listPlugins as apiListPlugins,
	removePlugin as apiRemovePlugin,
	runPluginCommand as apiRunPluginCommand,
	updatePlugin as apiUpdatePlugin,
	type DisablePluginResponses,
	type EnablePluginResponses,
	type InstallPluginResponses,
	type ListPluginCommandsResponses,
	type ListPluginRegistryResponses,
	type ListPluginsResponses,
	type RemovePluginResponses,
	type RunPluginCommandData,
	type RunPluginCommandResponses,
	type UpdatePluginResponses,
} from '@ottocode/api';
import { extractErrorMessage } from './utils';

export type PluginScope = 'global' | 'project';
export type PluginsListResponse = ListPluginsResponses[200];
export type PluginRegistryResponse = ListPluginRegistryResponses[200];
export type EffectivePlugin = PluginsListResponse['plugins'][number];
export type DiscoveredPlugin = PluginsListResponse['global']['plugins'][number];
export type PluginRegistryEntry = PluginRegistryResponse['plugins'][number];
export type PluginManifest = NonNullable<EffectivePlugin['manifest']>;
export type PluginCommand = NonNullable<PluginManifest['commands']>[string];
export type PluginCommandsListResponse = ListPluginCommandsResponses[200];
export type PluginCommandListEntry =
	PluginCommandsListResponse['commands'][number];
export type PluginCommandParameter = NonNullable<
	PluginCommandListEntry['parameters']
>[string];
export type PluginCommandRunResponse = RunPluginCommandResponses[200];
export type PluginCommandRunInput = RunPluginCommandData['body'];
export type PluginMutationResponse =
	| InstallPluginResponses[200]
	| RemovePluginResponses[200]
	| EnablePluginResponses[200]
	| DisablePluginResponses[200];
export type PluginUpdateResponse = UpdatePluginResponses[200];

export interface PluginProjectOptions {
	project?: string;
}

export interface PluginInstallInput extends PluginProjectOptions {
	source: string;
	scope?: PluginScope;
	enabled?: boolean;
}

export interface PluginMutationInput extends PluginProjectOptions {
	name: string;
	scope?: PluginScope;
}

export interface PluginUpdateInput extends PluginProjectOptions {
	name?: string;
	scope?: PluginScope;
}

export const pluginsMixin = {
	async listPlugins(
		options: PluginProjectOptions = {},
	): Promise<PluginsListResponse> {
		const response = await apiListPlugins({ query: options });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as PluginsListResponse;
	},

	async listPluginRegistry(
		options: PluginProjectOptions = {},
	): Promise<PluginRegistryResponse> {
		const response = await apiListPluginRegistry({ query: options });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as PluginRegistryResponse;
	},

	async listPluginCommands(
		options: PluginProjectOptions = {},
	): Promise<PluginCommandsListResponse> {
		const response = await apiListPluginCommands({ query: options });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as PluginCommandsListResponse;
	},

	async runPluginCommand(
		plugin: string,
		command: string,
		body: PluginCommandRunInput = {},
	): Promise<PluginCommandRunResponse> {
		const response = await apiRunPluginCommand({
			path: { plugin, command },
			body,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as PluginCommandRunResponse;
	},

	async installPlugin(
		input: PluginInstallInput,
	): Promise<PluginMutationResponse> {
		const response = await apiInstallPlugin({ body: input });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as InstallPluginResponses[200];
	},

	async removePlugin(
		input: PluginMutationInput,
	): Promise<PluginMutationResponse> {
		const response = await apiRemovePlugin({ body: input });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as RemovePluginResponses[200];
	},

	async enablePlugin(
		input: PluginMutationInput,
	): Promise<PluginMutationResponse> {
		const response = await apiEnablePlugin({ body: input });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as EnablePluginResponses[200];
	},

	async disablePlugin(
		input: PluginMutationInput,
	): Promise<PluginMutationResponse> {
		const response = await apiDisablePlugin({ body: input });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as DisablePluginResponses[200];
	},

	async updatePlugin(input: PluginUpdateInput): Promise<PluginUpdateResponse> {
		const response = await apiUpdatePlugin({ body: input });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as PluginUpdateResponse;
	},
};
