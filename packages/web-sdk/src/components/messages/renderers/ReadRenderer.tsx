import { ChevronRight, AlertCircle } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
	prism,
	vscDarkPlus,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { RendererProps } from './types';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';

function getLanguageFromPath(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase();
	const langMap: Record<string, string> = {
		js: 'javascript',
		jsx: 'jsx',
		ts: 'typescript',
		tsx: 'tsx',
		py: 'python',
		rb: 'ruby',
		go: 'go',
		rs: 'rust',
		java: 'java',
		c: 'c',
		cpp: 'cpp',
		h: 'c',
		hpp: 'cpp',
		cs: 'csharp',
		php: 'php',
		sh: 'bash',
		bash: 'bash',
		zsh: 'bash',
		sql: 'sql',
		json: 'json',
		yaml: 'yaml',
		yml: 'yaml',
		xml: 'xml',
		html: 'html',
		css: 'css',
		scss: 'scss',
		md: 'markdown',
		txt: 'text',
	};
	return langMap[ext || ''] || 'text';
}

function parseLineRange(lineRange: string | undefined): number | undefined {
	if (!lineRange) return undefined;
	const match = lineRange.match(/@(\d+)-(\d+)/);
	if (match) {
		return Number.parseInt(match[1], 10);
	}
	return undefined;
}

export function ReadRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: RendererProps) {
	const result = contentJson.result || {};
	const args = contentJson.args || {};

	const hasToolError =
		typeof result === 'object' && 'ok' in result && result.ok === false;
	const errorMessage =
		hasToolError && 'error' in result && typeof result.error === 'string'
			? result.error
			: null;
	const errorStack =
		hasToolError && 'stack' in result && typeof result.stack === 'string'
			? result.stack
			: undefined;

	const path = String(result.path || args.path || '');
	const content = String(result.content || '');
	const lineRange = result.lineRange as string | undefined;
	const lines = content.split('\n');
	const timeStr = formatDuration(toolDurationMs);
	const language = getLanguageFromPath(path);
	const syntaxTheme = document?.documentElement.classList.contains('dark')
		? vscDarkPlus
		: prism;

	const startingLineNumber = parseLineRange(lineRange);

	const displayText = lineRange
		? `${path}:${lineRange.replace('@', '')}`
		: path;

	const canExpand = content.length > 0 || hasToolError;

	return (
		<div className="text-[12px]">
			<button
				type="button"
				onClick={() => canExpand && onToggle()}
				className={`flex items-center gap-2 transition-colors w-full min-w-0 ${
					hasToolError
						? 'text-red-700 dark:text-red-300 hover:text-red-600 dark:hover:text-red-200'
						: canExpand
							? 'text-blue-700 dark:text-blue-300 hover:text-blue-600 dark:hover:text-blue-200'
							: 'text-blue-700 dark:text-blue-300'
				}`}
			>
				{canExpand ? (
					isExpanded ? (
						<ChevronRight className="h-3 w-3 flex-shrink-0 rotate-90 transition-transform" />
					) : (
						<ChevronRight className="h-3 w-3 flex-shrink-0 transition-transform" />
					)
				) : (
					<div className="w-3 flex-shrink-0" />
				)}
				{hasToolError && (
					<AlertCircle className="h-3 w-3 flex-shrink-0 text-red-600 dark:text-red-400" />
				)}
				<span className="font-medium flex-shrink-0">
					read{hasToolError ? ' error' : ''}
				</span>
				{!compact && (
					<>
						<span className="text-muted-foreground/70 flex-shrink-0">·</span>
						<span
							className="text-foreground/70 min-w-0 flex-shrink overflow-hidden text-ellipsis whitespace-nowrap"
							dir="rtl"
							title={displayText}
						>
							{`\u2066${displayText}\u2069`}
						</span>
					</>
				)}
				{!hasToolError && lines.length > 0 && !compact && (
					<span className="text-muted-foreground/80 flex-shrink-0 whitespace-nowrap">
						· {lines.length} lines · {timeStr}
					</span>
				)}
				{hasToolError && !compact && (
					<span className="text-muted-foreground/80 flex-shrink-0">
						· {timeStr}
					</span>
				)}
			</button>
			{isExpanded && hasToolError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
			)}
			{isExpanded && !hasToolError && content && (
				<div className="mt-2 ml-5 bg-card/60 border border-border rounded-lg overflow-hidden max-h-96 overflow-y-auto max-w-full">
					<div className="overflow-x-auto max-w-full">
						<SyntaxHighlighter
							language={language}
							style={syntaxTheme}
							customStyle={{
								margin: 0,
								padding: '0.75rem',
								fontSize: '0.75rem',
								lineHeight: '1.5',
								background: 'transparent',
								maxWidth: '100%',
							}}
							showLineNumbers
							startingLineNumber={startingLineNumber}
							wrapLines
							wrapLongLines
						>
							{content}
						</SyntaxHighlighter>
					</div>
				</div>
			)}
		</div>
	);
}
