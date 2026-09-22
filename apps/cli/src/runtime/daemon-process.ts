interface ProcessProbe {
	signal?: typeof process.kill;
	spawnSync?: typeof Bun.spawnSync;
	platform?: NodeJS.Platform;
}

/** Treats unreaped Unix zombies as stopped; unknown process states stay alive. */
export function isDaemonProcessAlive(
	pid: number,
	probe: ProcessProbe = {},
): boolean {
	try {
		if (!(probe.signal ?? process.kill)(pid, 0)) return false;
	} catch (error) {
		return !(
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ESRCH'
		);
	}
	if ((probe.platform ?? process.platform) === 'win32') return true;
	try {
		// kill(pid, 0) also succeeds for zombies until their parent reaps them.
		const result = (probe.spawnSync ?? Bun.spawnSync)(
			['ps', '-p', String(pid), '-o', 'stat='],
			{ stdout: 'pipe', stderr: 'ignore', timeout: 1000 },
		);
		if (result.success && result.stdout.toString().trim().startsWith('Z')) {
			return false;
		}
	} catch {}
	return true;
}
