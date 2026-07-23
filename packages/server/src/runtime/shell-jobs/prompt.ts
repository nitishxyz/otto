import type { ShellJobSnapshot } from '../tools/active-shells.ts';

function resultText(job: ShellJobSnapshot): string {
	if (job.result == null) return '';
	if (typeof job.result === 'string') return job.result;
	try {
		return JSON.stringify(job.result, null, 2);
	} catch {
		return String(job.result);
	}
}

export function buildShellJobResultsPrompt(jobs: ShellJobSnapshot[]): string {
	const blocks = jobs.map((job) =>
		[
			`<shell_result id="${job.id}" status="${job.status}" exit_code="${job.exitCode ?? ''}">`,
			`<command>${job.command}</command>`,
			resultText(job),
			'</shell_result>',
		].join('\n'),
	);
	return [
		'<shell_results>',
		...blocks,
		'</shell_results>',
		'',
		'Detached shell jobs completed. Use these results without polling.',
	].join('\n');
}
