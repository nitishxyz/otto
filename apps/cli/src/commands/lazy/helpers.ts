import { Command } from 'commander';

export type RegisterCommand = (program: Command) => void;
export type RegisterVersionedCommand = (
	program: Command,
	version: string,
) => void;

export async function dispatchRegisteredCommand(
	register: RegisterCommand,
	argv: string[],
): Promise<void> {
	const program = new Command();
	register(program);
	await program.parseAsync(argv, { from: 'user' });
}

export async function dispatchVersionedCommand(
	register: RegisterVersionedCommand,
	version: string,
	argv: string[],
): Promise<void> {
	const program = new Command();
	register(program, version);
	await program.parseAsync(argv, { from: 'user' });
}

export function pushFlag(
	argv: string[],
	flag: string,
	enabled: boolean | undefined,
) {
	if (enabled) argv.push(flag);
}

export function pushOption(
	argv: string[],
	flag: string,
	value: string | number | undefined,
) {
	if (value !== undefined) argv.push(flag, String(value));
}

export function pushVariadicOption(
	argv: string[],
	flag: string,
	values: string[] | undefined,
) {
	if (values?.length) argv.push(flag, ...values);
}
