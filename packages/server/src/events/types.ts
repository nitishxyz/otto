export type OttoEventType =
	| 'tool.approval.required'
	| 'tool.approval.updated'
	| 'tool.approval.resolved'
	| 'shell.secure_input.required'
	| 'shell.secure_input.resolved'
	| 'ottorouter.payment.required'
	| 'ottorouter.payment.signing'
	| 'ottorouter.payment.complete'
	| 'ottorouter.payment.error'
	| 'ottorouter.topup.required'
	| 'ottorouter.topup.method_selected'
	| 'ottorouter.topup.cancelled'
	| 'ottorouter.fiat.checkout_created'
	| 'ottorouter.balance.updated'
	| 'session.created'
	| 'session.deleted'
	| 'session.updated'
	| 'message.created'
	| 'message.updated'
	| 'message.part.delta'
	| 'reasoning.delta'
	| 'message.completed'
	| 'tool.call'
	| 'tool.delta'
	| 'tool.result'
	| 'shell.job.updated'
	| 'shell.job.output'
	| 'plan.updated'
	| 'goal.updated'
	| 'finish-step'
	| 'usage'
	| 'queue.updated'
	| 'error'
	| 'heartbeat';

export interface OttoEvent<T = unknown> {
	type: OttoEventType;
	sessionId: string;
	projectId?: string;
	projectRoot?: string;
	payload?: T;
}

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotificationAction {
	label: string;
	href: string;
}

export interface NotificationEvent {
	id: string;
	level: NotificationLevel;
	title: string;
	body?: string;
	action?: NotificationAction;
	createdAt: string;
	expiresAt?: string;
	source?: 'agent' | 'system' | 'session' | 'auth' | 'billing';
	sessionId?: string;
	projectId?: string;
	projectRoot?: string;
}

export interface SessionStatusEvent {
	sessionId: string;
	projectId?: string;
	projectRoot?: string;
	status: 'running' | 'completed' | 'failed' | 'needs_attention';
	messageId?: string;
	createdAt: string;
}

export interface ReferencePreparationEvent {
	name: string;
	url: string;
	ref?: string;
	projectRoot: string;
	status: 'cloning' | 'available' | 'error';
	error?: string;
	output?: string[];
}

export type ClientEvent =
	| { type: 'notification'; payload: NotificationEvent }
	| { type: 'session.status'; payload: SessionStatusEvent }
	| { type: 'reference.preparation'; payload: ReferencePreparationEvent }
	| { type: 'heartbeat'; payload: { createdAt: string } };
