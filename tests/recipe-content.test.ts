import { describe, expect, it } from 'bun:test';
import {
	parseRecipeContent,
	serializeRecipeContent,
} from '../packages/web-sdk/src/lib/recipe-content';

describe('recipe content fields', () => {
	it('parses structured fields and preserves unknown metadata', () => {
		const parsed = parseRecipeContent(
			[
				'---',
				'description: "Prepare a release"',
				'agent: review',
				'includeInHistory: false',
				'oneShot: true',
				'---',
				'',
				'Review the changes and list every release issue.',
			].join('\n'),
		);

		expect(parsed).toEqual({
			description: 'Prepare a release',
			agent: 'review',
			includeInHistory: false,
			instructions: 'Review the changes and list every release issue.',
			unknownFrontmatter: ['oneShot: true'],
		});
	});

	it('serializes fields without exposing or dropping unknown metadata', () => {
		const content = serializeRecipeContent({
			description: 'Check changes: client and server',
			agent: 'build',
			includeInHistory: true,
			instructions: 'Check every change and explain any problem.',
			unknownFrontmatter: ['oneShot: true'],
		});

		expect(content).toContain(
			'description: "Check changes: client and server"',
		);
		expect(content).toContain('agent: "build"');
		expect(content).toContain('includeInHistory: true');
		expect(content).toContain('oneShot: true');
		expect(parseRecipeContent(content).instructions).toBe(
			'Check every change and explain any problem.',
		);
	});

	it('blocks malformed frontmatter from being silently overwritten', () => {
		const parsed = parseRecipeContent(
			'---\ndescription: Broken\nInstructions without a closing marker',
		);

		expect(parsed.error).toContain('cannot be edited safely');
		expect(parsed.instructions).toBe('');
	});

	it('treats plain Markdown as instructions', () => {
		const parsed = parseRecipeContent('Review this change.\n');

		expect(parsed.instructions).toBe('Review this change.');
		expect(parsed.agent).toBe('build');
		expect(parsed.includeInHistory).toBe(true);
	});
});
