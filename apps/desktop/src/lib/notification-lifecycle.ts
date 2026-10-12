import {
	acceptsNotificationSessionOpen,
	type NotificationSessionOpen,
	type NotificationWindowContext,
} from './notification-routing';

export function createNotificationRegistrationQueue() {
	let pending = Promise.resolve();
	return (operation: () => Promise<void>) => {
		const next = pending.then(operation);
		pending = next.catch(() => {});
		return next;
	};
}

const enqueueRegistration = createNotificationRegistrationQueue();

interface NotificationLifecycleOptions {
	windowLabel: string;
	context: NotificationWindowContext;
	isCurrent: () => boolean;
	listen: (
		handler: (payload: NotificationSessionOpen) => void,
	) => Promise<() => void>;
	register: (context: NotificationWindowContext | null) => Promise<void>;
	unminimize: () => Promise<void>;
	show: () => Promise<void>;
	focus: () => Promise<void>;
	refresh: (sessionId: string) => Promise<void>;
	navigate: (sessionId: string) => void;
	onError: (error: unknown) => void;
	enqueue?: ReturnType<typeof createNotificationRegistrationQueue>;
}

/** Keeps availability publication and cleanup ordered across workspace mounts. */
export function createNotificationLifecycle(
	options: NotificationLifecycleOptions,
) {
	let cancelled = false;
	let unlisten: (() => void) | undefined;
	let published = false;
	const enqueue = options.enqueue ?? enqueueRegistration;
	const isCurrent = () => !cancelled && options.isCurrent();
	const activate = async (sessionId: string) => {
		for (const operation of [options.unminimize, options.show, options.focus]) {
			if (!isCurrent()) return;
			await operation().catch(() => {});
		}
		if (!isCurrent()) return;
		await options.refresh(sessionId);
		if (!isCurrent()) return;
		options.navigate(sessionId);
	};
	const ready = options
		.listen((payload) => {
			if (
				!isCurrent() ||
				!acceptsNotificationSessionOpen(
					payload,
					options.windowLabel,
					options.context.workspace,
				)
			)
				return;
			void activate(payload.sessionId).catch(options.onError);
		})
		.then(async (stop) => {
			if (!isCurrent()) {
				stop();
				return;
			}
			unlisten = stop;
			await enqueue(async () => {
				if (!isCurrent()) return;
				published = true;
				await options.register(options.context);
			});
		})
		.catch(options.onError);

	return {
		activate,
		ready,
		dispose() {
			if (cancelled) return;
			cancelled = true;
			unlisten?.();
			void enqueue(async () => {
				if (published) await options.register(null);
			}).catch(options.onError);
		},
	};
}
