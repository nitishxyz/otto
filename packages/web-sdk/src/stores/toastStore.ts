import { create } from 'zustand';

export type ToastType = 'default' | 'success' | 'error' | 'loading';

export interface Toast {
	id: string;
	message: string;
	type: ToastType;
	duration?: number;
	icon?: string;
	action?: {
		label: string;
		href?: string;
		onClick?: () => void | Promise<void>;
	};
}

interface ToastState {
	toasts: Toast[];
	addToast: (toast: Omit<Toast, 'id'>) => string;
	removeToast: (id: string) => void;
	updateToast: (id: string, updates: Partial<Omit<Toast, 'id'>>) => void;
	clearToasts: () => void;
}

let toastId = 0;

export const useToastStore = create<ToastState>((set) => ({
	toasts: [],
	addToast: (toast) => {
		const id = `toast-${++toastId}`;
		set((state) => ({
			toasts: [...state.toasts, { ...toast, id }],
		}));
		return id;
	},
	removeToast: (id) =>
		set((state) => ({
			toasts: state.toasts.filter((t) => t.id !== id),
		})),
	updateToast: (id, updates) =>
		set((state) => ({
			toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...updates } : t)),
		})),
	clearToasts: () => set({ toasts: [] }),
}));

export function toast(
	message: string,
	type: ToastType = 'default',
	duration = 4000,
) {
	const id = useToastStore.getState().addToast({ message, type, duration });
	if (duration > 0) {
		setTimeout(() => {
			useToastStore.getState().removeToast(id);
		}, duration);
	}
	return id;
}

toast.success = (message: string, duration = 4000) =>
	toast(message, 'success', duration);
toast.error = (message: string, duration = 5000) =>
	toast(message, 'error', duration);
toast.info = (message: string, duration = 4000) =>
	toast(message, 'default', duration);
toast.loading = (message: string) => toast(message, 'loading', 0);

toast.successWithAction = (
	message: string,
	action: {
		label: string;
		href?: string;
		onClick?: () => void | Promise<void>;
	},
	duration = 6000,
) => {
	const id = useToastStore.getState().addToast({
		message,
		type: 'success',
		duration,
		action,
	});
	if (duration > 0) {
		setTimeout(() => {
			useToastStore.getState().removeToast(id);
		}, duration);
	}
	return id;
};
