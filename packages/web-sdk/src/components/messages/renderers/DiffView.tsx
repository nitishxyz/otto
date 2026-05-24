import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
	prism,
	vscDarkPlus,
} from 'react-syntax-highlighter/dist/esm/styles/prism';

interface DiffViewProps {
	patch: string;
}

interface DiffLine {
	content: string;
	codeContent: string; // Content without +/- prefix
	type: 'add' | 'remove' | 'context' | 'meta' | 'header';
	oldLineNum?: number;
	newLineNum?: number;
}

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
		md: 'text',
		markdown: 'text',
		mdx: 'text',
		txt: 'text',
		svelte: 'svelte',
	};
	return langMap[ext || ''] || 'javascript';
}

function parseDiff(patch: string): { lines: DiffLine[]; filePath: string } {
	const lines = patch.split('\n');
	const result: DiffLine[] = [];
	let oldLineNum = 0;
	let newLineNum = 0;
	let inHunk = false;
	let filePath = '';

	for (const line of lines) {
		// Extract file path from diff headers
		// Also enter hunk mode for enveloped format
		const lineModePath = line.match(
			/^\*\*\* (?:Delete Lines in|Replace Lines in|Insert Before in|Insert After in): (.+)$/,
		);
		if (lineModePath?.[1]) {
			filePath = lineModePath[1];
			inHunk = false;
		}

		if (
			line.startsWith('*** Update File:') ||
			line.startsWith('*** Add File:')
		) {
			const match = line.match(/\*\*\* (?:Update|Add) File: (.+)/);
			if (match) filePath = match[1];
			inHunk = true;
			newLineNum = 1;
			oldLineNum = 1;
		}
		if (line.startsWith('+++') || line.startsWith('*** Update File:')) {
			const match =
				line.match(/\+\+\+ b\/(.+)/) || line.match(/\*\*\* Update File: (.+)/);
			if (match) filePath = match[1];
		}

		// Parse hunk header to get starting line numbers
		// Format: @@ -oldStart,oldCount +newStart,newCount @@
		const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunkMatch) {
			oldLineNum = Number.parseInt(hunkMatch[1], 10);
			newLineNum = Number.parseInt(hunkMatch[2], 10);
			inHunk = true;
			result.push({
				content: line,
				codeContent: line,
				type: 'header',
			});
			continue;
		}

		// Handle enveloped format @@ comment lines (not standard hunk headers)
		if (line.startsWith('@@') && !line.match(/^@@ -\d+/)) {
			inHunk = true;
			result.push({
				content: line,
				codeContent: line,
				type: 'header',
			});
			continue;
		}

		// Check if it's a diff metadata line
		if (
			line.startsWith('***') ||
			line.startsWith('diff ') ||
			line.startsWith('index ') ||
			line.startsWith('---') ||
			line.startsWith('+++')
		) {
			result.push({
				content: line,
				codeContent: line,
				type: 'meta',
			});
			continue;
		}

		// Process actual diff lines
		if (inHunk) {
			if (line.startsWith('+')) {
				result.push({
					content: line,
					codeContent: line.slice(1),
					type: 'add',
					newLineNum: newLineNum++,
				});
			} else if (line.startsWith('-')) {
				result.push({
					content: line,
					codeContent: line.slice(1),
					type: 'remove',
					oldLineNum: oldLineNum++,
				});
			} else if (line.startsWith(' ') || line === '') {
				result.push({
					content: line,
					codeContent: line.startsWith(' ') ? line.slice(1) : line,
					type: 'context',
					oldLineNum: oldLineNum++,
					newLineNum: newLineNum++,
				});
			} else {
				// Handle lines that don't start with +, -, or space (edge case)
				result.push({
					content: line,
					codeContent: line,
					type: 'context',
				});
			}
		} else {
			// Lines before any hunk
			result.push({
				content: line,
				codeContent: line,
				type: 'meta',
			});
		}
	}

	return { lines: result, filePath };
}

export function DiffView({ patch }: DiffViewProps) {
	const { lines: diffLines, filePath } = parseDiff(patch);
	const language = getLanguageFromPath(filePath);
	const syntaxTheme = document?.documentElement.classList.contains('dark')
		? vscDarkPlus
		: prism;

	return (
		<div className="bg-card/60 border border-border rounded-lg overflow-hidden max-h-96 max-w-full">
			<div className="overflow-x-auto overflow-y-auto max-h-96 text-xs font-mono">
				<div className="min-w-max">
					{diffLines.map((line, i) => {
						const key = `line-${i}-${line.content.slice(0, 20)}`;

						// For meta and header lines, span the full width without line numbers
						if (line.type === 'meta' || line.type === 'header') {
							return (
								<div
									key={key}
									className={`px-3 py-0.5 whitespace-pre ${
										line.type === 'header'
											? 'text-muted-foreground/80 bg-muted/20'
											: 'text-muted-foreground/80'
									}`}
								>
									{line.content}
								</div>
							);
						}

						// For diff lines, show line numbers in gutter
						let lineClass = '';
						let bgClass = '';
						switch (line.type) {
							case 'add':
								lineClass = 'text-emerald-700 dark:text-emerald-300';
								bgClass = 'bg-emerald-500/10';
								break;
							case 'remove':
								lineClass = 'text-red-600 dark:text-red-300';
								bgClass = 'bg-red-500/10';
								break;
							default:
								lineClass = 'text-foreground/80';
						}

						// Apply syntax highlighting to code content
						let renderedContent: React.ReactNode = line.content;
						if (line.codeContent.trim() && language !== 'text') {
							renderedContent = (
								<SyntaxHighlighter
									language={language}
									style={syntaxTheme}
									customStyle={{
										margin: 0,
										padding: 0,
										background: 'transparent',
										display: 'inline',
										fontSize: 'inherit',
										lineHeight: 'inherit',
									}}
									codeTagProps={{
										style: {
											fontFamily: 'inherit',
											background: 'transparent',
										},
									}}
									PreTag="span"
								>
									{line.codeContent}
								</SyntaxHighlighter>
							);

							// Add back the +/- prefix
							if (line.type === 'add') {
								renderedContent = (
									<>
										<span className="select-none">+</span>
										{renderedContent}
									</>
								);
							} else if (line.type === 'remove') {
								renderedContent = (
									<>
										<span className="select-none">-</span>
										{renderedContent}
									</>
								);
							} else if (line.type === 'context') {
								renderedContent = (
									<>
										<span className="select-none"> </span>
										{renderedContent}
									</>
								);
							}
						}

						return (
							<div key={key} className={`flex ${bgClass}`}>
								{/* Old line number */}
								<div className="px-2 py-0.5 text-right text-muted-foreground/40 select-none w-12 flex-shrink-0">
									{line.oldLineNum || ''}
								</div>
								{/* New line number */}
								<div className="px-2 py-0.5 text-right text-muted-foreground/40 select-none w-12 flex-shrink-0 border-r border-border/50">
									{line.newLineNum || ''}
								</div>
								{/* Line content */}
								<div
									className={`px-3 py-0.5 flex-1 whitespace-pre ${lineClass}`}
								>
									{renderedContent}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
