import { Code2, Sparkles } from 'lucide-react';
import { memo, useMemo } from 'react';
import { CopyButton } from './renderers/shared';

const ARTIFACT_FENCE = /^```artifact-html\s*\n([\s\S]*?)\n```\s*$/i;
const HTML_FENCE = /^```html\s*\n([\s\S]*?)\n```\s*$/i;
const COMPLETE_DOCUMENT =
	/^(?:<!doctype\s+html[^>]*>\s*)?<html\b[\s\S]*<\/html>\s*$/i;
const ARTIFACT_CSP = [
	"default-src 'none'",
	"script-src 'unsafe-inline'",
	"style-src 'unsafe-inline'",
	'img-src data: blob:',
	'font-src data:',
	'media-src data: blob:',
	"connect-src 'none'",
	"frame-src 'none'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');

export function extractHtmlArtifact(content: string): string | null {
	const trimmed = content.trim();
	const fenced = trimmed.match(ARTIFACT_FENCE) ?? trimmed.match(HTML_FENCE);
	const html = (fenced?.[1] ?? trimmed).trim();
	return COMPLETE_DOCUMENT.test(html) ? html : null;
}

function getArtifactTitle(html: string): string {
	const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
	return title ? title.replace(/\s+/g, ' ') : 'HTML Artifact';
}

function applyArtifactCsp(html: string): string {
	const meta = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;
	if (/<head\b[^>]*>/i.test(html)) {
		return html.replace(/<head\b[^>]*>/i, (head) => `${head}${meta}`);
	}
	return html.replace(
		/<html\b[^>]*>/i,
		(root) => `${root}<head>${meta}</head>`,
	);
}

interface HtmlArtifactProps {
	html: string;
}

export const HtmlArtifact = memo(function HtmlArtifact({
	html,
}: HtmlArtifactProps) {
	const title = useMemo(() => getArtifactTitle(html), [html]);
	const srcDoc = useMemo(() => applyArtifactCsp(html), [html]);

	return (
		<section className="my-3 overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
			<header className="flex h-12 items-center gap-3 border-b border-border bg-muted/35 px-4">
				<div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<Sparkles className="size-3.5" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium">{title}</div>
					<div className="flex items-center gap-1 text-[11px] text-muted-foreground">
						<Code2 className="size-3" /> HTML Artifact
					</div>
				</div>
				<CopyButton text={html} size="sm" />
			</header>
			<iframe
				title={title}
				srcDoc={srcDoc}
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				loading="lazy"
				className="h-[min(680px,75vh)] min-h-[420px] w-full border-0 bg-white"
			/>
		</section>
	);
});
