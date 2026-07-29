import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import {
	loadFonts,
	renderBlogOG,
	renderDocsOG,
	renderLandingOG,
	renderOttoRouterOG,
	renderShareOG,
	satoriFonts,
} from './index';

type Fonts = Awaited<ReturnType<typeof loadFonts>>;
type OGElement = ReturnType<typeof renderLandingOG>;

async function generateImage(
	element: OGElement,
	fonts: Fonts,
): Promise<Buffer> {
	const svg = await satori(element, {
		width: 1200,
		height: 630,
		fonts: satoriFonts(fonts),
	});

	const resvg = new Resvg(svg, {
		fitTo: { mode: 'width', value: 1200 },
	});
	return Buffer.from(resvg.render().asPng());
}

async function main() {
	console.log('Generating OG image previews...\n');
	const fonts = await loadFonts();

	const previews: Array<[string, OGElement]> = [
		['preview-landing.png', renderLandingOG()],
		['preview-ottorouter.png', renderOttoRouterOG({ type: 'ottorouter' })],
		[
			'preview-docs.png',
			renderDocsOG({
				type: 'docs',
				title: 'System Architecture',
				section: 'Architecture',
				description:
					'Understand the modular architecture powering otto across CLI, desktop, and embedded interfaces.',
			}),
		],
		[
			'preview-blog.png',
			renderBlogOG({
				type: 'blog',
				title: 'Introducing otto v1.0',
				description:
					'One tool, multiple interfaces. Open source AI coding assistant.',
				author: 'nitish',
				date: 'Mar 5, 2026',
			}),
		],
		[
			'preview-share.png',
			renderShareOG({
				title: 'Audit Solana program with detailed solutions',
				username: 'bat',
				model: 'claude-opus-4-20250514',
				provider: 'anthropic',
				messageCount: 42,
				inputTokens: 550900,
				outputTokens: 12300,
				createdAt: Date.now(),
				shareId: 'test-preview',
			}),
		],
	];

	for (const [file, element] of previews) {
		writeFileSync(file, await generateImage(element, fonts));
		console.log(`✓ ${file}`);
	}

	console.log('\nDone! All previews generated.');
}

main().catch(console.error);
