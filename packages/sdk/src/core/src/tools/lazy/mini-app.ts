import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import {
	inspectMiniApp,
	type MiniAppArtifact,
} from '../../mini-apps/manifest.ts';
import { compileMiniApp } from '../../mini-apps/compiler.ts';
import { createToolError } from '../error.ts';
import { resolveSafePath } from '../builtin/fs/util.ts';

const miniAppInputSchema = z.object({
	action: z.enum(['build', 'present']),
	root: z
		.string()
		.min(1)
		.describe('Project-relative directory containing app.json and app source.'),
	previewUrl: z
		.string()
		.optional()
		.describe(
			'Optional local HTTP(S) preview URL. Start the app separately before presenting it.',
		),
});

function validateLocalPreviewUrl(value: string): string {
	const url = new URL(value);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Mini App previews must use HTTP or HTTPS');
	}
	if (url.username || url.password) {
		throw new Error('Mini App preview URLs cannot contain credentials');
	}
	const hostname = url.hostname.toLowerCase();
	if (
		hostname !== 'localhost' &&
		hostname !== '127.0.0.1' &&
		hostname !== '[::1]'
	) {
		throw new Error('Mini App previews currently support localhost URLs only');
	}
	return url.toString();
}

async function resolveMiniAppRoot(
	projectRoot: string,
	inputRoot: string,
): Promise<{ appRoot: string; projectRealRoot: string }> {
	const safeRoot = resolveSafePath(projectRoot, inputRoot);
	const [projectRealRoot, appRoot] = await Promise.all([
		realpath(projectRoot),
		realpath(safeRoot),
	]);
	const relativeRoot = relative(projectRealRoot, appRoot);
	if (
		relativeRoot === '..' ||
		relativeRoot.startsWith(`..${sep}`) ||
		isAbsolute(relativeRoot)
	) {
		throw new Error(`Mini App root resolves outside the project: ${inputRoot}`);
	}
	return { appRoot, projectRealRoot };
}

export function buildMiniAppTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	return {
		name: 'mini_app',
		tool: tool({
			description: [
				'Validate and present a first-class Otto Mini App in chat.',
				'Use only when the user explicitly asks for an Otto Mini App, an app installed inside Otto, project/global app installation, or promotion of existing work into a Mini App.',
				'An ordinary request to build an app, website, landing page, dashboard, or component means normal project work and must not use this tool.',
				'A Mini App must be an application package with app.json and source modules; do not use this tool for a raw index.html file.',
				'Use build to compile an otto-react app with the curated runtime and create a local preview. Use present only for validation or an already-running localhost preview.',
			].join(' '),
			inputSchema: miniAppInputSchema,
			execute: async (input) => {
				try {
					const { appRoot, projectRealRoot } = await resolveMiniAppRoot(
						projectRoot,
						input.root,
					);
					const inspected =
						input.action === 'build'
							? await compileMiniApp(projectRealRoot, appRoot)
							: await inspectMiniApp(appRoot);
					const { manifest, contentHash } = inspected;
					const builtPreviewPath =
						'previewPath' in inspected &&
						typeof inspected.previewPath === 'string'
							? inspected.previewPath
							: undefined;
					const previewUrl = input.previewUrl
						? validateLocalPreviewUrl(input.previewUrl)
						: undefined;
					const artifact: MiniAppArtifact = {
						kind: 'mini_app',
						schemaVersion: 1,
						appId: manifest.id,
						name: manifest.name,
						description: manifest.description,
						runtime: manifest.runtime,
						root: relative(projectRealRoot, appRoot).replace(/\\/g, '/'),
						entry: manifest.entry,
						contentHash,
						revisionId: contentHash.slice(0, 12),
						availability: manifest.availability,
						permissions: manifest.permissions,
						capabilities: manifest.capabilities,
						placements: manifest.placements,
						previewUrl,
						previewPath: builtPreviewPath,
					};
					return {
						ok: true,
						action: input.action,
						app: artifact,
						artifact,
						message:
							input.action === 'build'
								? `Built ${manifest.name} with the curated Otto runtime`
								: previewUrl
									? `Presented ${manifest.name} with a local preview`
									: `Presented ${manifest.name}; build it to interact with it`,
					};
				} catch (error) {
					return createToolError(
						error instanceof Error ? error.message : String(error),
						'validation',
						{ action: input.action, root: input.root },
					);
				}
			},
		}),
	};
}
