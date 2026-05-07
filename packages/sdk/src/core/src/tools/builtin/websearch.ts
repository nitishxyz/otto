import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import DESCRIPTION from './websearch.txt' with { type: 'text' };
import { createToolError, type ToolResponse } from '../error.ts';
import {
	fetchUrlContent,
	searchDuckDuckGo,
	type WebFetchResult,
	type WebSearchResult,
} from './websearch-strategies.ts';

export function buildWebSearchTool(): {
	name: string;
	tool: Tool;
} {
	const websearch = tool({
		description: DESCRIPTION,
		inputSchema: z
			.object({
				url: z
					.string()
					.optional()
					.describe(
						'URL to fetch content from (mutually exclusive with query)',
					),
				query: z
					.string()
					.optional()
					.describe(
						'Search query to search the web (mutually exclusive with url)',
					),
				maxLength: z
					.number()
					.optional()
					.default(50000)
					.describe(
						'Maximum content length to return (default: 50000 characters)',
					),
			})
			.strict()
			.refine((data) => (data.url ? !data.query : !!data.query), {
				message: 'Must provide either url or query, but not both',
			}),
		async execute({
			url,
			query,
			maxLength,
		}: {
			url?: string;
			query?: string;
			maxLength?: number;
		}): Promise<ToolResponse<WebFetchResult | WebSearchResult>> {
			if (url) {
				return fetchUrlContent(url, maxLength ?? 50000);
			}

			if (query) {
				return searchDuckDuckGo(query);
			}

			return createToolError(
				'Must provide either url or query parameter',
				'validation',
				{
					suggestion: 'Provide either a url to fetch or a query to search',
				},
			);
		},
	});

	return { name: 'websearch', tool: websearch };
}
