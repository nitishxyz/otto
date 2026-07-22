import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import DESCRIPTION from './search.txt' with { type: 'text' };
import { createToolError, type ToolResponse } from '../error.ts';
import {
	getFffFinder,
	refreshFffIndex,
	resolveFffSearchScope,
} from '../../search/fff.ts';
import { searchFiles, type FileSearchResult } from './file-search.ts';

const TEXT_MAX = 200;

type SearchMatch = { file: string; line: number; text: string };

type SearchToolResult = {
	count: number;
	matches: SearchMatch[];
	truncated?: boolean;
	shownMatches?: number;
	files?: Array<{ file: string; matches: number }>;
};

type SearchInput = {
	query: string;
	mode?: 'content' | 'files';
	path?: string;
	ignoreCase?: boolean;
	glob?: string[];
	ignore?: string[];
	maxResults?: number;
};

function truncateText(text: string): string {
	return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text;
}

function buildFffQuery(args: {
	query: string;
	pathConstraint: string;
	glob?: string;
	ignoreCase?: boolean;
}): string {
	const constraints = [args.pathConstraint, args.glob]
		.map((part) => part?.trim() ?? '')
		.filter(Boolean);
	const query = args.ignoreCase ? `(?i)${args.query}` : args.query;
	return [...constraints, query].join(' ');
}

function summarizeMatches(matches: SearchMatch[]) {
	const fileCounts = new Map<string, number>();
	for (const match of matches) {
		fileCounts.set(match.file, (fileCounts.get(match.file) ?? 0) + 1);
	}
	return Array.from(fileCounts.entries()).map(([file, count]) => ({
		file,
		matches: count,
	}));
}

export function buildSearchTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	const search = tool({
		description: DESCRIPTION,
		inputSchema: z.object({
			query: z
				.string()
				.min(1)
				.describe('Regex for content mode; glob pattern for files mode'),
			mode: z.enum(['content', 'files']).optional().default('content'),
			path: z
				.string()
				.optional()
				.default('.')
				.describe('Relative path to search in'),
			ignoreCase: z.boolean().optional().default(false),
			glob: z
				.array(z.string())
				.optional()
				.describe('Content mode: file patterns to include'),
			ignore: z
				.array(z.string())
				.optional()
				.describe('Files mode: additional patterns to exclude'),
			maxResults: z.number().int().min(1).max(5000).optional().default(100),
		}),
		async execute({
			query,
			mode = 'content',
			path = '.',
			ignoreCase,
			glob,
			ignore,
			maxResults = 100,
		}: SearchInput): Promise<
			ToolResponse<SearchToolResult | FileSearchResult>
		> {
			if (mode === 'files') {
				return searchFiles({
					projectRoot,
					pattern: query,
					path,
					ignore,
					limit: Math.min(maxResults, 1000),
				});
			}
			try {
				const { basePath, constraint } = await resolveFffSearchScope(
					projectRoot,
					path,
				);
				await refreshFffIndex(basePath);
				const finder = await getFffFinder(basePath);
				const includeGlobs =
					Array.isArray(glob) && glob.length > 0 ? glob : [undefined];
				const matches: SearchMatch[] = [];
				const seen = new Set<string>();
				let truncated = false;

				for (const includeGlob of includeGlobs) {
					if (matches.length >= maxResults) {
						truncated = true;
						break;
					}

					const fffQuery = buildFffQuery({
						query,
						pathConstraint: constraint,
						glob: includeGlob,
						ignoreCase,
					});
					const result = finder.grep(fffQuery, {
						mode: 'regex',
						smartCase: false,
						pageSize: maxResults - matches.length,
						maxMatchesPerFile: maxResults,
					});

					if (!result.ok) {
						return createToolError(result.error, 'execution', {
							suggestion: 'Check if the search query is valid',
						});
					}

					for (const item of result.value.items) {
						const match = {
							file: item.relativePath,
							line: item.lineNumber,
							text: truncateText(item.lineContent),
						};
						const key = `${match.file}:${match.line}:${match.text}`;
						if (seen.has(key)) continue;
						seen.add(key);
						matches.push(match);
						if (matches.length >= maxResults) break;
					}

					truncated = truncated || Boolean(result.value.nextCursor);
				}

				const files = summarizeMatches(matches);

				return {
					ok: true,
					count: matches.length,
					matches,
					...(truncated
						? { truncated: true, shownMatches: matches.length }
						: {}),
					...(files.length ? { files } : {}),
				};
			} catch (err) {
				return createToolError(String(err), 'execution', {
					suggestion: 'Check if FFF is available and the query is valid',
				});
			}
		},
	});
	return { name: 'search', tool: search };
}
