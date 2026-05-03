import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushFlag, pushOption } from './helpers.ts';

export function registerSkillsCommand(program: Command) {
	const skills = program.command('skills').description('Manage agent skills');

	skills
		.command('list', { isDefault: true })
		.description('List all discovered skills')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--json', 'Output as JSON', false)
		.action(async (opts) => {
			const argv = ['skills', 'list'];
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--json', opts.json);
			const { registerSkillsCommand: register } = await import('../skills.ts');
			await dispatchRegisteredCommand(register, argv);
		});

	skills
		.command('show <name>')
		.description('Show skill content')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--json', 'Output as JSON', false)
		.action(async (name, opts) => {
			const argv = ['skills', 'show', name];
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--json', opts.json);
			const { registerSkillsCommand: register } = await import('../skills.ts');
			await dispatchRegisteredCommand(register, argv);
		});

	skills
		.command('create')
		.alias('new')
		.description('Create a new skill (interactive)')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			const argv = ['skills', 'create'];
			pushOption(argv, '--project', opts.project);
			const { registerSkillsCommand: register } = await import('../skills.ts');
			await dispatchRegisteredCommand(register, argv);
		});

	skills
		.command('validate [path]')
		.description('Validate a SKILL.md file')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (skillPath, opts) => {
			const argv = ['skills', 'validate'];
			if (skillPath) argv.push(skillPath);
			pushOption(argv, '--project', opts.project);
			const { registerSkillsCommand: register } = await import('../skills.ts');
			await dispatchRegisteredCommand(register, argv);
		});
}
