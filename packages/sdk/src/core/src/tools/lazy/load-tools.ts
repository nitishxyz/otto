import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';

export type LazyToolBrief = {
	name: string;
	description: string;
};

export function buildLazyToolCatalogDescription(
	briefs: LazyToolBrief[],
): string {
	if (briefs.length === 0) return 'No lazy tools available.';
	return briefs
		.map((brief) => `${brief.name}: ${brief.description.slice(0, 80)}`)
		.join('\n');
}

export function buildLoadToolsTool(briefs: LazyToolBrief[]): {
	name: string;
	tool: Tool;
} {
	const catalog = buildLazyToolCatalogDescription(briefs);
	const validNames = new Set(briefs.map((brief) => brief.name));

	return {
		name: 'load_tools',
		tool: tool({
			description: `Load tools for the next step.\n${catalog}`,
			inputSchema: z.object({
				tools: z.array(z.string()).describe('Tool names to load'),
			}),
			execute: async ({ tools: requested }) => {
				const loaded: string[] = [];
				const notFound: string[] = [];
				for (const name of requested) {
					if (validNames.has(name)) {
						loaded.push(name);
					} else {
						notFound.push(name);
					}
				}
				return {
					ok: true,
					loaded,
					...(notFound.length > 0 ? { notFound } : {}),
				};
			},
		}),
	};
}
