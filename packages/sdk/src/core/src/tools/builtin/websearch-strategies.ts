import { createToolError, type ToolResponse } from '../error.ts';

export type WebFetchResult = {
	url: string;
	content: string;
	contentLength: number;
	truncated: boolean;
	contentType: string;
};

export type WebSearchResult = {
	query: string;
	results: Array<{ title: string; url: string; snippet: string }>;
	count: number;
};

const FETCH_HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (compatible; otto-bot/1.0; +https://github.com/anthropics/otto)',
	Accept:
		'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
};

const SEARCH_HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
	Accept: 'text/html',
};

export async function fetchUrlContent(
	url: string,
	maxLength: number,
): Promise<ToolResponse<WebFetchResult>> {
	try {
		const response = await fetch(url, {
			headers: FETCH_HEADERS,
			redirect: 'follow',
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(
				`HTTP error! status: ${response.status} ${response.statusText}`,
			);
		}

		const contentType = response.headers.get('content-type') || '';
		if (!isTextContentType(contentType)) {
			return createToolError(
				`Unsupported content type: ${contentType}. Only text-based content can be fetched.`,
				'unsupported',
				{ contentType },
			);
		}

		const content = await response.text();
		const cleanContent = cleanHtmlContent(content);
		const truncated = cleanContent.slice(0, maxLength);
		const wasTruncated = cleanContent.length > maxLength;

		return {
			ok: true,
			url,
			content: truncated,
			contentLength: cleanContent.length,
			truncated: wasTruncated,
			contentType,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return createToolError(
			`Failed to fetch URL: ${errorMessage}`,
			'execution',
			{
				url,
			},
		);
	}
}

export async function searchDuckDuckGo(
	query: string,
): Promise<ToolResponse<WebSearchResult>> {
	try {
		const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
		const response = await fetch(searchUrl, {
			headers: SEARCH_HEADERS,
			redirect: 'follow',
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(`Search failed: ${response.status}`);
		}

		const html = await response.text();
		const results = parseDuckDuckGoResults(html);
		if (results.length === 0) {
			return createToolError(
				'No search results found. The search service may have changed its format or blocked the request.',
				'execution',
				{
					query,
					suggestion:
						'Try using the url parameter to fetch a specific webpage instead.',
				},
			);
		}

		return {
			ok: true,
			query,
			results,
			count: results.length,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return createToolError(`Search failed: ${errorMessage}`, 'execution', {
			query,
			suggestion:
				'Search services may be temporarily unavailable. Try using the url parameter to fetch a specific webpage instead.',
		});
	}
}

function isTextContentType(contentType: string): boolean {
	return (
		contentType.includes('text/') ||
		contentType.includes('application/json') ||
		contentType.includes('application/xml') ||
		contentType.includes('application/xhtml')
	);
}

function cleanHtmlContent(content: string): string {
	return content
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
		.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function parseDuckDuckGoResults(
	html: string,
): Array<{ title: string; url: string; snippet: string }> {
	const parsed = parseDuckDuckGoResultBlocks(html);
	return parsed.length > 0 ? parsed : parseDuckDuckGoSimpleLinks(html);
}

function parseDuckDuckGoResultBlocks(
	html: string,
): Array<{ title: string; url: string; snippet: string }> {
	const results: Array<{ title: string; url: string; snippet: string }> = [];
	const resultPattern =
		/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

	let match: RegExpExecArray | null = resultPattern.exec(html);
	while (match !== null && results.length < 10) {
		const url = match[1]?.trim();
		const title = match[2]?.trim();
		const snippet = cleanSearchSnippet(match[3]);

		if (url && title) {
			results.push({ title, url, snippet });
		}
		match = resultPattern.exec(html);
	}
	return results;
}

function parseDuckDuckGoSimpleLinks(
	html: string,
): Array<{ title: string; url: string; snippet: string }> {
	const results: Array<{ title: string; url: string; snippet: string }> = [];
	const simplePattern =
		/<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
	let match: RegExpExecArray | null = simplePattern.exec(html);
	while (match !== null && results.length < 10) {
		const url = match[1]?.trim();
		const title = match[2]?.trim();
		if (url && title && url.startsWith('http')) {
			results.push({ title, url, snippet: '' });
		}
		match = simplePattern.exec(html);
	}
	return results;
}

function cleanSearchSnippet(snippet: string | undefined): string {
	return (
		snippet
			?.replace(/<[^>]+>/g, '')
			.replace(/\s+/g, ' ')
			.trim() || ''
	);
}
