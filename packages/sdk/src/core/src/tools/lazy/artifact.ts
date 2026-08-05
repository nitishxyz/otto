import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { compileReactArtifact } from '../../artifacts/compiler.ts';
import { ARTIFACT_AUTHORING_GUIDE } from '../../artifacts/runtime.ts';
import { createToolError } from '../error.ts';

const artifactInputSchema = z.object({
	artifactId: z
		.string()
		.regex(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/)
		.describe(
			'Stable lowercase kebab-case ID for this conversational artifact.',
		),
	title: z.string().min(1).max(120),
	description: z.string().max(280).optional(),
	source: z
		.string()
		.min(1)
		.describe(
			'TSX module with a default React component. May import @otto/artifact, react, motion, and lucide-react.',
		),
	styles: z
		.string()
		.optional()
		.describe(
			'Optional artifact-specific CSS for custom visualizations only. Do not restyle standard Otto runtime components.',
		),
});

export function buildArtifactTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	return {
		name: 'artifact',
		tool: tool({
			description: [
				'Create or revise a first-class visual or interactive Artifact rendered inline in Otto chat.',
				'Use only when the user explicitly asks for an Artifact or asks to turn a conversational result into one.',
				'Do not emit raw HTML and do not write project source files.',
				'Provide one TSX module whose default export is a React component.',
				'The curated runtime supports React, motion/react, lucide-react, and @otto/artifact.',
				'Use the same artifactId to create a new immutable revision of an existing Artifact.',
				ARTIFACT_AUTHORING_GUIDE,
			].join('\n\n'),
			inputSchema: artifactInputSchema,
			execute: async (input) => {
				try {
					const build = await compileReactArtifact(projectRoot, input);
					const artifact = {
						kind: 'artifact' as const,
						schemaVersion: 1 as const,
						artifactId: build.artifactId,
						title: build.title,
						description: build.description,
						runtime: build.runtime,
						contentHash: build.contentHash,
						revisionId: build.revisionId,
						previewPath: build.previewPath,
						libraries: build.libraries,
					};
					return {
						ok: true,
						artifact,
						cached: build.cached,
						message: `Rendered ${build.title} with the Otto Artifact runtime`,
					};
				} catch (error) {
					return createToolError(
						error instanceof Error ? error.message : String(error),
						'validation',
						{ artifactId: input.artifactId },
					);
				}
			},
		}),
	};
}
