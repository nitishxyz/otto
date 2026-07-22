#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { setDebugEnabled, setTraceEnabled } from '@ottocode/sdk';
import {
	compareAudits,
	createManifest,
	createPromptAudit,
	type PromptAuditArtifact,
	type PromptAuditManifest,
	writeFullArtifact,
} from './lib/prompt-audit.ts';

setDebugEnabled(false);
setTraceEnabled(false);

const args = process.argv.slice(2);
const command = args.shift() ?? 'snapshot';

if (command === 'snapshot') {
	const projectRoot = option('--project') ?? process.cwd();
	const artifact = await createPromptAudit({
		projectRoot,
		agent: option('--agent') ?? 'build',
		provider: option('--provider') ?? 'openrouter',
		model: option('--model') ?? 'anthropic/claude-sonnet-4',
		mode: (option('--mode') ?? 'default') as 'default' | 'oneshot',
		userText: option('--user') ?? 'Deterministic prompt audit input.',
		freezeTime: option('--freeze-time') ?? '2026-01-01T00:00:00.000Z',
		hmacKey: process.env.AGI_PROMPT_AUDIT_KEY,
	});
	const fullPath = option('--full');
	if (fullPath) {
		await writeFullArtifact(resolve(fullPath), artifact);
		console.error(
			`Sensitive full prompt artifact written owner-readable (0600): ${resolve(fullPath)}`,
		);
	} else {
		console.log(
			JSON.stringify(
				createManifest(artifact, process.env.AGI_PROMPT_AUDIT_KEY),
				null,
				2,
			),
		);
	}
} else if (command === 'compare') {
	const paths = args.filter((value) => !value.startsWith('--'));
	if (paths.length < 2)
		throw new Error('compare requires 2+ snapshot or manifest paths');
	const items = await Promise.all(
		paths.map(async (path) => ({
			label: basename(path),
			value: JSON.parse(await readFile(path, 'utf8')) as
				| PromptAuditArtifact
				| PromptAuditManifest,
		})),
	);
	console.log(JSON.stringify(compareAudits(items), null, 2));
} else {
	throw new Error(
		'usage: bun run scripts/prompt-audit.ts snapshot [options] | compare <2+ files>',
	);
}

function option(name: string): string | undefined {
	const equals = args.find((value) => value.startsWith(`${name}=`));
	if (equals) return equals.slice(name.length + 1);
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}
