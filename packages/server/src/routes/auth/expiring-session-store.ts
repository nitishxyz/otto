export interface ExpiringSessionStoreOptions<T> {
	ttlMs: number;
	now?: () => number;
	onDelete?: (value: T, reason: 'delete' | 'take' | 'expired') => void;
}

interface StoredSession<T> {
	value: T;
	expiresAt: number;
}

/** In-memory auth-flow state with lazy expiry and deterministic lifecycle hooks. */
export class ExpiringSessionStore<T> {
	private readonly sessions = new Map<string, StoredSession<T>>();
	private readonly now: () => number;

	constructor(private readonly options: ExpiringSessionStoreOptions<T>) {
		this.now = options.now ?? Date.now;
	}

	create(id: string, value: T): T {
		this.delete(id);
		this.sessions.set(id, {
			value,
			expiresAt: this.now() + this.options.ttlMs,
		});
		return value;
	}

	set(id: string, value: T): this {
		this.create(id, value);
		return this;
	}

	get(id: string): T | undefined {
		const session = this.sessions.get(id);
		if (!session) return undefined;
		if (session.expiresAt <= this.now()) {
			this.remove(id, session, 'expired');
			return undefined;
		}
		return session.value;
	}

	has(id: string): boolean {
		return this.get(id) !== undefined;
	}

	take(id: string): T | undefined {
		const value = this.get(id);
		if (value === undefined) return undefined;
		const session = this.sessions.get(id);
		if (session) this.remove(id, session, 'take');
		return value;
	}

	delete(id: string): boolean {
		const session = this.sessions.get(id);
		if (!session) return false;
		this.remove(id, session, 'delete');
		return true;
	}

	clear(): void {
		for (const [id, session] of this.sessions) {
			this.remove(id, session, 'delete');
		}
	}

	sweep(): number {
		const now = this.now();
		let removed = 0;
		for (const [id, session] of this.sessions) {
			if (session.expiresAt > now) continue;
			this.remove(id, session, 'expired');
			removed++;
		}
		return removed;
	}

	private remove(
		id: string,
		session: StoredSession<T>,
		reason: 'delete' | 'take' | 'expired',
	): void {
		this.sessions.delete(id);
		this.options.onDelete?.(session.value, reason);
	}
}
