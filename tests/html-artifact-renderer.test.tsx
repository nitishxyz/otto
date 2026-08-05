import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	extractHtmlArtifact,
	HtmlArtifact,
} from '../packages/web-sdk/src/components/messages/HtmlArtifact';

const DOCUMENT =
	'<!doctype html><html><head><title>Momentum</title></head><body><button>Complete</button><script>document.body.dataset.ready = "true";</script></body></html>';

describe('HTML artifact rendering', () => {
	test('recognizes complete bare and artifact-fenced documents', () => {
		expect(extractHtmlArtifact(DOCUMENT)).toBe(DOCUMENT);
		expect(
			extractHtmlArtifact(`\`\`\`artifact-html\n${DOCUMENT}\n\`\`\``),
		).toBe(DOCUMENT);
	});

	test('does not reinterpret partial HTML or ordinary markdown', () => {
		expect(extractHtmlArtifact('<div>Example</div>')).toBeNull();
		expect(extractHtmlArtifact('Use `<html>` to start a document.')).toBeNull();
	});

	test('renders the document in a script-only sandbox with a restrictive CSP', () => {
		const markup = renderToStaticMarkup(<HtmlArtifact html={DOCUMENT} />);

		expect(markup).toContain('HTML Artifact');
		expect(markup).toContain('sandbox="allow-scripts"');
		expect(markup).toContain('Content-Security-Policy');
		expect(markup).toContain('connect-src &#x27;none&#x27;');
		expect(markup).toContain('<iframe');
	});
});
