import type {
	EffectivePlugin,
	PluginCommand,
	PluginCommandParameter,
	PluginScope,
} from '@ottocode/sdk';

export type PluginCommandListEntry = {
	plugin: string;
	command: string;
	label?: string;
	description?: string;
	parameters?: Record<string, PluginCommandParameter>;
	allowExtraArgs?: boolean;
	previewUrl?: string;
	scope: PluginScope;
};

export type ResolvedPluginCommand = {
	plugin: EffectivePlugin;
	commandName: string;
	definition: PluginCommand;
	previewUrl?: string;
};

export type PluginCommandInvocation = {
	plugin: string;
	command: string;
	argsText: string;
};

export type ParsedPluginCommandArgs =
	| {
			ok: true;
			values: Record<string, string | number | boolean>;
			extraArgs: string[];
	  }
	| { ok: false; error: string };

export type RenderedPluginCommandSpec = {
	command: string;
	args: string[];
	env?: Record<string, string>;
	cwd?: string;
};

export type RenderedPluginCommand =
	| {
			ok: true;
			primary: RenderedPluginCommandSpec;
			fallback?: RenderedPluginCommandSpec;
	  }
	| { ok: false; error: string };

export type RenderPluginCommandOptions = {
	pluginDir: string;
	extraArgs?: string[];
};

export type PluginCommandRunResult = {
	command: string;
	terminalId: string;
	title: string;
	previewUrl?: string;
	execution: 'started';
};
