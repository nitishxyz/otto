import type { Tool } from 'ai';
import { buildForgeTool } from './forge.ts';
import { SERVER_LAZY_TOOL_CATALOG } from './lazy-catalog.ts';

export type ServerLazyToolDefinition = {
	name: string;
	description: string;
	build: (projectRoot: string) => { name: string; tool: Tool };
};

export type ConfiguredServerTool = {
	name: string;
	description: string;
	tool: Tool;
};

export function getServerLazyToolDefinitions(): ServerLazyToolDefinition[] {
	return SERVER_LAZY_TOOL_CATALOG.map((definition) => ({
		...definition,
		build: buildForgeTool,
	}));
}

export function buildConfiguredServerTools(args: {
	projectRoot: string;
	firstClassNames: Iterable<string>;
	loadableNames: Iterable<string>;
}): {
	firstClass: ConfiguredServerTool[];
	loadable: ConfiguredServerTool[];
} {
	const firstClassNames = new Set(args.firstClassNames);
	const loadableNames = new Set(args.loadableNames);
	const firstClass: ConfiguredServerTool[] = [];
	const loadable: ConfiguredServerTool[] = [];

	for (const definition of getServerLazyToolDefinitions()) {
		if (
			!firstClassNames.has(definition.name) &&
			!loadableNames.has(definition.name)
		) {
			continue;
		}
		const built = definition.build(args.projectRoot);
		const configured = {
			name: built.name,
			description: definition.description,
			tool: built.tool,
		};
		if (firstClassNames.has(definition.name)) {
			firstClass.push(configured);
		} else {
			loadable.push(configured);
		}
	}

	return { firstClass, loadable };
}
