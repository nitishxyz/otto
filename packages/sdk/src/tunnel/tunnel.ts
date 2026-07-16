import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ensureTunnelBinary } from './binary.ts';

export interface TunnelConnection {
	id: string;
	ip: string;
	location: string;
}

export interface TunnelEvents {
	url: (url: string) => void;
	connected: (connection: TunnelConnection) => void;
	disconnected: (connection: TunnelConnection) => void;
	error: (error: Error) => void;
	exit: (code: number | null, signal: NodeJS.Signals | null) => void;
	stdout: (data: string) => void;
	stderr: (data: string) => void;
}

/** Injectable process dependencies used to test tunnel lifecycle behavior. */
export interface OttoTunnelDependencies {
	ensureBinary: typeof ensureTunnelBinary;
	spawn: typeof spawn;
}

const URL_REGEX = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/;
const REGISTERED_CONNECTION_REGEX = /Registered tunnel connection/i;
const CONN_REGEX = /\bconnection(?:=|\s+)([^\s]+)/i;
const IP_REGEX = /\bip=([^\s]+)/i;
const LOCATION_REGEX = /\blocation=([^\s]+)/i;
const INDEX_REGEX = /connIndex=(\d+)/;

const RATE_LIMIT_REGEX = /429 Too Many Requests|error code: 1015/i;
const FAILED_UNMARSHAL_REGEX = /failed to unmarshal quick Tunnel/i;

export class OttoTunnel extends EventEmitter {
	private readonly dependencies: OttoTunnelDependencies;
	private process: ChildProcess | null = null;
	private connections: (TunnelConnection | undefined)[] = [];
	private outputBuffers = { stdout: '', stderr: '' };
	private _url: string | null = null;
	private _stopped = false;

	constructor(dependencies: Partial<OttoTunnelDependencies> = {}) {
		super();
		this.dependencies = {
			ensureBinary: dependencies.ensureBinary ?? ensureTunnelBinary,
			spawn: dependencies.spawn ?? spawn,
		};
	}

	get url(): string | null {
		return this._url;
	}

	get isRunning(): boolean {
		return this.process !== null && !this._stopped;
	}

	private handleOutput(output: string): void {
		const urlMatch = output.match(URL_REGEX);
		if (urlMatch && !this._url) {
			this._url = urlMatch[0];
			this.emit('url', this._url);
		}

		const connMatch = output.match(CONN_REGEX);
		const ipMatch = output.match(IP_REGEX);
		const locationMatch = output.match(LOCATION_REGEX);
		const indexMatch = output.match(INDEX_REGEX);

		if (REGISTERED_CONNECTION_REGEX.test(output) && indexMatch) {
			const index = Number(indexMatch[1]);
			if (!this.connections[index]) {
				const connection: TunnelConnection = {
					id: connMatch?.[1] ?? `connection-${index}`,
					ip: ipMatch?.[1] ?? '',
					location: locationMatch?.[1] ?? '',
				};
				this.connections[index] = connection;
				this.emit('connected', connection);
			}
		}

		if (output.includes('terminated') && indexMatch) {
			const index = Number(indexMatch[1]);
			const conn = this.connections[index];
			if (conn) {
				this.emit('disconnected', conn);
				this.connections[index] = undefined;
			}
		}
	}

	private handleOutputChunk(
		output: string,
		stream: 'stdout' | 'stderr',
	): boolean {
		const combined = `${this.outputBuffers[stream]}${output}`;
		if (this.checkForRateLimit(combined)) return false;

		const lines = combined.split(/\r?\n/);
		const pending = lines.pop() ?? '';
		for (const line of lines) this.handleOutput(line);
		if (pending) this.handleOutput(pending);
		this.outputBuffers[stream] = pending.slice(-8192);
		return true;
	}

	private checkForRateLimit(output: string): boolean {
		if (RATE_LIMIT_REGEX.test(output) || FAILED_UNMARSHAL_REGEX.test(output)) {
			const error: Error & { code?: string } = new Error(
				'Rate limited by Cloudflare. Please wait 5-10 minutes before trying again.',
			);
			error.code = 'RATE_LIMITED';
			this.emit('error', error);
			return true;
		}
		return false;
	}

	private async startProcess(
		args: string[],
		readiness: 'url' | 'connected',
		knownUrl: string | null,
		onProgress?: (message: string) => void,
	): Promise<string> {
		if (this.process) {
			throw new Error('Tunnel is already running');
		}

		const binPath = await this.dependencies.ensureBinary(onProgress);
		this._stopped = false;
		this._url = knownUrl;
		this.connections = [];
		this.outputBuffers = { stdout: '', stderr: '' };

		return new Promise((resolve, reject) => {
			let settled = false;
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				this.off('url', handleUrl);
				this.off('connected', handleConnected);
				this.off('error', handleError);
				if (error) reject(error);
				else if (this._url) resolve(this._url);
				else reject(new Error('Tunnel URL was not available'));
			};
			const handleUrl = () => finish();
			const handleConnected = () => finish();
			const handleError = (error: Error) => finish(error);
			const timeout = setTimeout(() => {
				this.stop();
				finish(new Error('Tunnel startup timed out'));
			}, 30000);

			if (readiness === 'url') this.once('url', handleUrl);
			else this.once('connected', handleConnected);
			this.once('error', handleError);

			this.process = this.dependencies.spawn(binPath, args, {
				stdio: ['ignore', 'pipe', 'pipe'],
			});

			this.process.on('error', (error) => {
				this.emit('error', error);
			});

			this.process.on('exit', (code, signal) => {
				this._stopped = true;
				this.process = null;
				this.emit('exit', code, signal);
				finish(new Error('Tunnel process exited before it was ready'));
			});

			this.process.stdout?.on('data', (data: Buffer) => {
				const output = data.toString();
				this.emit('stdout', output);
				if (!this.handleOutputChunk(output, 'stdout')) {
					this.stop();
				}
			});

			this.process.stderr?.on('data', (data: Buffer) => {
				const output = data.toString();
				this.emit('stderr', output);
				if (!this.handleOutputChunk(output, 'stderr')) {
					this.stop();
				}
			});
		});
	}

	async start(
		port: number,
		onProgress?: (message: string) => void,
	): Promise<string> {
		return this.startProcess(
			['tunnel', '--url', `http://localhost:${port}`],
			'url',
			null,
			onProgress,
		);
	}

	/** Start a named tunnel and wait for its first registered connection. */
	async startManaged(
		token: string,
		url: string,
		onProgress?: (message: string) => void,
	): Promise<string> {
		if (!token) throw new Error('Managed tunnel token is required');
		return this.startProcess(
			['tunnel', 'run', '--token', token],
			'connected',
			url,
			onProgress,
		);
	}

	stop(): boolean {
		if (!this.process) {
			return false;
		}

		this._stopped = true;
		const killed = this.process.kill('SIGINT');

		setTimeout(() => {
			if (this.process && !this.process.killed) {
				this.process.kill('SIGKILL');
			}
		}, 5000);

		return killed;
	}

	on<K extends keyof TunnelEvents>(event: K, listener: TunnelEvents[K]): this {
		return super.on(event, listener);
	}

	once<K extends keyof TunnelEvents>(
		event: K,
		listener: TunnelEvents[K],
	): this {
		return super.once(event, listener);
	}

	emit<K extends keyof TunnelEvents>(
		event: K,
		...args: Parameters<TunnelEvents[K]>
	): boolean {
		return super.emit(event, ...args);
	}
}

/**
 * Kill any existing tunnel processes to prevent stale tunnels
 * from interfering with new ones
 */
export async function killStaleTunnels(): Promise<void> {
	try {
		const { exec } = await import('node:child_process');
		const { promisify } = await import('node:util');
		const execAsync = promisify(exec);

		// Kill any existing tunnel processes (but not the parent otto process)
		const killCmd =
			process.platform === 'win32'
				? 'taskkill /F /IM tunnel.exe 2>NUL || exit /b 0'
				: 'pkill -f "tunnel tunnel (--url|run --token)" 2>/dev/null || true';
		await execAsync(killCmd);
		// Give processes time to die
		await new Promise((resolve) => setTimeout(resolve, 500));
	} catch {
		// Ignore errors - pkill might not find any processes
	}
}

export async function createTunnel(
	port: number,
	onProgress?: (message: string) => void,
): Promise<{ url: string; tunnel: OttoTunnel }> {
	// Kill any stale tunnel processes first
	await killStaleTunnels();

	const tunnel = new OttoTunnel();
	const url = await tunnel.start(port, onProgress);
	return { url, tunnel };
}
