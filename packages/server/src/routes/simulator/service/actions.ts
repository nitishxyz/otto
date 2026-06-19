import { runServeSim } from './command.ts';

export async function sendSimulatorButton(name = 'home', device?: string) {
	const args = ['button', name, '--quiet'];
	if (device) args.push('-d', device);
	const result = await runServeSim(args);
	return {
		ok: result.exitCode === 0,
		button: name,
		stdout: result.stdout,
		stderr: result.stderr,
		error: result.exitCode === 0 ? undefined : result.stderr || result.stdout,
	};
}

export async function sendSimulatorGesture(gesture: unknown, device?: string) {
	const args = ['gesture', JSON.stringify(gesture), '--quiet'];
	if (device) args.push('-d', device);
	const result = await runServeSim(args);
	return {
		ok: result.exitCode === 0,
		gesture,
		stdout: result.stdout,
		stderr: result.stderr,
		error: result.exitCode === 0 ? undefined : result.stderr || result.stdout,
	};
}

export async function rotateSimulator(orientation: string, device?: string) {
	const args = ['rotate', orientation, '--quiet'];
	if (device) args.push('-d', device);
	const result = await runServeSim(args);
	return {
		ok: result.exitCode === 0,
		orientation,
		stdout: result.stdout,
		stderr: result.stderr,
		error: result.exitCode === 0 ? undefined : result.stderr || result.stdout,
	};
}
