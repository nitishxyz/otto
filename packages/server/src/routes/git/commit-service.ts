import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import {
	appendCoAuthorTrailer,
	getAuth,
	getFastModelForAuth,
	getProviderDefinition,
	loadConfig,
	type ProviderId,
} from '@ottocode/sdk';
import { generateText, streamText } from 'ai';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import {
	detectOAuth,
	adaptSimpleCall,
} from '../../runtime/provider/oauth-adapter.ts';
import { resolveModel } from '../../runtime/provider/index.ts';
import { gitCommitSchema, gitGenerateCommitMessageSchema } from './schemas.ts';
import { parseGitStatus, validateAndGetGitRoot } from './utils.ts';

const execFileAsync = promisify(execFile);

export async function handleCommitChanges(c: Context) {
	try {
		const body = await c.req.json();
		const { message, project } = gitCommitSchema.parse(body);
		const requestedPath = project || process.cwd();

		const validation = await validateAndGetGitRoot(requestedPath);
		if ('error' in validation) {
			return c.json(
				{ status: 'error', error: validation.error, code: validation.code },
				400,
			);
		}

		const fullMessage = appendCoAuthorTrailer(message);
		const { stdout } = await execFileAsync(
			'git',
			['commit', '-m', fullMessage],
			{
				cwd: validation.gitRoot,
			},
		);

		return c.json({
			status: 'ok',
			data: {
				message: stdout.trim(),
			},
		});
	} catch (error) {
		return c.json(
			{
				status: 'error',
				error: error instanceof Error ? error.message : 'Failed to commit',
			},
			500,
		);
	}
}

async function getSessionProviderModel(sessionId?: string) {
	if (!sessionId) return {};
	const db = await getDb();
	const [session] = await db
		.select({ provider: sessions.provider, model: sessions.model })
		.from(sessions)
		.where(eq(sessions.id, sessionId));
	return {
		provider: session?.provider as ProviderId | undefined,
		model: session?.model ?? undefined,
	};
}

function buildCommitPrompt(fileList: string, diff: string): string {
	return `Generate a commit message for these git changes.

Staged files:
${fileList}

Diff (first 4000 chars):
${diff.slice(0, 4000)}

Guidelines:
- CAREFULLY READ the diff above - describe what ACTUALLY changed
- Use conventional commits format: type(scope): description
- First line under 72 characters
- Add a blank line, then 2-4 short bullet points
- Each bullet describes ONE specific change you see in the diff
- Be ACCURATE - don't invent changes that aren't in the diff
- Keep bullets short (under 80 chars each)
- Do not include markdown code blocks or backticks
- Return ONLY the commit message text, nothing else

Example (for a diff that adds boolean returns to functions):
refactor(auth): return success status from login functions

- Add boolean return type to auth functions
- Return false on user cancellation or failure
- Check return value before proceeding with auth flow

Commit message:`;
}

export async function handleGenerateCommitMessage(c: Context) {
	try {
		const body = await c.req.json();
		const { project, sessionId } = gitGenerateCommitMessageSchema.parse(body);
		const requestedPath = project || process.cwd();

		const validation = await validateAndGetGitRoot(requestedPath);
		if ('error' in validation) {
			return c.json(
				{ status: 'error', error: validation.error, code: validation.code },
				400,
			);
		}

		const { stdout: diff } = await execFileAsync('git', ['diff', '--cached'], {
			cwd: validation.gitRoot,
		});

		if (!diff.trim()) {
			return c.json(
				{
					status: 'error',
					error: 'No staged changes to generate message from',
				},
				400,
			);
		}

		const { stdout: statusOutput } = await execFileAsync(
			'git',
			['status', '--porcelain=v2'],
			{ cwd: validation.gitRoot },
		);
		const { staged } = parseGitStatus(statusOutput, validation.gitRoot);
		const fileList = staged.map((f) => `${f.status}: ${f.path}`).join('\n');
		const config = await loadConfig();
		const session = await getSessionProviderModel(sessionId);
		const provider =
			session.provider ??
			((config.defaults?.provider || 'anthropic') as ProviderId);
		const currentModel =
			session.model ?? config.defaults?.model ?? 'claude-3-5-sonnet-20241022';
		const auth = await getAuth(provider, config.projectRoot);
		const oauth = detectOAuth(provider, auth);
		const providerDefinition = getProviderDefinition(config, provider);
		const modelId =
			providerDefinition?.source === 'custom' ||
			providerDefinition?.compatibility === 'ollama'
				? currentModel
				: (getFastModelForAuth(provider, auth?.type) ?? currentModel);
		const model = await resolveModel(provider, modelId, config);

		const adapted = adaptSimpleCall(oauth, {
			instructions:
				'You are a helpful assistant that generates accurate git commit messages based on the actual diff content.',
			userContent: buildCommitPrompt(fileList, diff),
			maxOutputTokens: 500,
		});

		if (adapted.forceStream) {
			const result = streamText({
				model,
				system: adapted.system,
				messages: adapted.messages,
				providerOptions: adapted.providerOptions,
			});
			let text = '';
			for await (const chunk of result.textStream) {
				text += chunk;
			}
			return c.json({ status: 'ok', data: { message: text.trim() } });
		}

		const { text } = await generateText({
			model,
			system: adapted.system,
			messages: adapted.messages,
			maxOutputTokens: adapted.maxOutputTokens,
			providerOptions: adapted.providerOptions,
		});

		return c.json({
			status: 'ok',
			data: {
				message: text.trim(),
			},
		});
	} catch (error) {
		return c.json(
			{
				status: 'error',
				error:
					error instanceof Error
						? error.message
						: 'Failed to generate commit message',
			},
			500,
		);
	}
}
