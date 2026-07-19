export type DefaultsChange = Readonly<Record<string, unknown>>;

type DefaultsChangeListener = (defaults: DefaultsChange) => void;

const defaultsChangeListeners = new Set<DefaultsChangeListener>();

/** Merges a defaults change into an already loaded config value. */
export function mergeDefaultsChange<
	TDefaults extends object,
	TConfig extends { defaults: TDefaults },
>(config: TConfig | undefined, defaults: DefaultsChange): TConfig | undefined {
	if (!config) return undefined;
	const currentDefaults = config.defaults as Record<string, unknown>;
	if (
		Object.entries(defaults).every(([key, value]) =>
			Object.is(currentDefaults[key], value),
		)
	) {
		return config;
	}
	return {
		...config,
		defaults: { ...config.defaults, ...defaults },
	};
}

/** Notifies config consumers about an optimistic defaults change. */
export function emitDefaultsChange(defaults: DefaultsChange): void {
	for (const listener of defaultsChangeListeners) listener(defaults);
}

/** Subscribes to optimistic defaults changes across React Query clients. */
export function onDefaultsChange(listener: DefaultsChangeListener): () => void {
	defaultsChangeListeners.add(listener);
	return () => defaultsChangeListeners.delete(listener);
}
