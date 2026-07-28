import { useState, useCallback, type RefObject } from 'react';

function htmlToMarkdown(el: HTMLElement): string {
	const lines: string[] = [];

	function walk(node: Node): string {
		if (node.nodeType === Node.TEXT_NODE) {
			return node.textContent ?? '';
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return '';

		const el = node as HTMLElement;
		// Layout-only blocks (diagrams) opt out of the DOM walk and provide
		// their own plain-text form via `data-md`.
		if (el.hasAttribute('data-md-skip')) return '';
		const authored = el.getAttribute('data-md');
		if (authored) return `\`\`\`\n${authored.trim()}\n\`\`\`\n\n`;

		const tag = el.tagName.toLowerCase();
		const children = () => Array.from(node.childNodes).map(walk).join('');

		switch (tag) {
			case 'h1':
				return `# ${children().trim()}\n\n`;
			case 'h2':
				return `## ${children().trim()}\n\n`;
			case 'h3':
				return `### ${children().trim()}\n\n`;
			case 'h4':
				return `#### ${children().trim()}\n\n`;
			case 'p':
				return `${children().trim()}\n\n`;
			case 'strong':
			case 'b':
				return `**${children().trim()}**`;
			case 'em':
			case 'i':
				return `*${children().trim()}*`;
			case 'code': {
				const parent = (node as HTMLElement).parentElement;
				if (parent && parent.tagName.toLowerCase() === 'pre') {
					return children();
				}
				return `\`${children().trim()}\``;
			}
			case 'pre': {
				const code = children().trim();
				return `\`\`\`\n${code}\n\`\`\`\n\n`;
			}
			case 'a': {
				const href = (node as HTMLAnchorElement).getAttribute('href') ?? '';
				return `[${children().trim()}](${href})`;
			}
			case 'ul': {
				const items = Array.from(node.childNodes)
					.filter(
						(c) =>
							c.nodeType === Node.ELEMENT_NODE &&
							(c as HTMLElement).tagName.toLowerCase() === 'li',
					)
					.map((li) => `- ${walk(li).trim()}`)
					.join('\n');
				return `${items}\n\n`;
			}
			case 'ol': {
				const items = Array.from(node.childNodes)
					.filter(
						(c) =>
							c.nodeType === Node.ELEMENT_NODE &&
							(c as HTMLElement).tagName.toLowerCase() === 'li',
					)
					.map((li, i) => `${i + 1}. ${walk(li).trim()}`)
					.join('\n');
				return `${items}\n\n`;
			}
			case 'li':
				return children();
			case 'table': {
				const rows: string[][] = [];
				const thead = (node as HTMLElement).querySelector('thead');
				const tbody = (node as HTMLElement).querySelector('tbody');
				if (thead) {
					for (const tr of Array.from(thead.querySelectorAll('tr'))) {
						rows.push(
							Array.from(tr.querySelectorAll('th,td')).map(
								(c) => c.textContent?.trim() ?? '',
							),
						);
					}
				}
				const headerLen = rows.length;
				if (tbody) {
					for (const tr of Array.from(tbody.querySelectorAll('tr'))) {
						rows.push(
							Array.from(tr.querySelectorAll('th,td')).map(
								(c) => c.textContent?.trim() ?? '',
							),
						);
					}
				}
				if (rows.length === 0) return children();
				const colCount = Math.max(...rows.map((r) => r.length));
				const out: string[] = [];
				for (let i = 0; i < rows.length; i++) {
					const row = rows[i];
					while (row.length < colCount) row.push('');
					out.push(`| ${row.join(' | ')} |`);
					if (i === (headerLen > 0 ? headerLen - 1 : 0)) {
						out.push(`| ${Array(colCount).fill('---').join(' | ')} |`);
					}
				}
				return `${out.join('\n')}\n\n`;
			}
			case 'br':
				return '\n';
			case 'hr':
				return '---\n\n';
			case 'button':
			case 'svg':
				return '';
			default:
				return children();
		}
	}

	for (const child of Array.from(el.childNodes)) {
		lines.push(walk(child));
	}
	return lines
		.join('')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function CopyMarkdownButton({
	contentRef,
}: {
	contentRef: RefObject<HTMLDivElement | null>;
}) {
	const [copied, setCopied] = useState(false);

	const copy = useCallback(() => {
		if (!contentRef.current) return;
		const md = htmlToMarkdown(contentRef.current);
		navigator.clipboard.writeText(md).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}, [contentRef]);

	return (
		<button
			type="button"
			onClick={copy}
			className="np-edge np-shadow-sm np-press [--np-edge-hover:var(--otto-text)] flex items-center gap-1.5 rounded-[3px] bg-otto-bg px-3 py-1.5 text-xs text-otto-muted hover:text-otto-text"
			title="Copy page as Markdown"
		>
			{copied ? (
				<>
					<svg
						aria-hidden="true"
						className="w-3.5 h-3.5 text-emerald-500"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M20 6 9 17l-5-5" />
					</svg>
					<span className="text-emerald-500">Copied</span>
				</>
			) : (
				<>
					<svg
						aria-hidden="true"
						className="w-3.5 h-3.5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
						<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
					</svg>
					<span>Copy as Markdown</span>
				</>
			)}
		</button>
	);
}
