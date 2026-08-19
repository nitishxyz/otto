import { z } from 'zod';

export const serverEventTypeSchema = z.enum([
	'tool.approval.required',
	'tool.approval.updated',
	'tool.approval.resolved',
	'shell.secure_input.required',
	'shell.secure_input.resolved',
	'ottorouter.payment.required',
	'ottorouter.payment.signing',
	'ottorouter.payment.complete',
	'ottorouter.payment.error',
	'ottorouter.topup.required',
	'ottorouter.topup.method_selected',
	'ottorouter.topup.cancelled',
	'ottorouter.fiat.checkout_created',
	'ottorouter.balance.updated',
	'session.created',
	'session.deleted',
	'session.updated',
	'message.created',
	'message.updated',
	'message.part.delta',
	'reasoning.delta',
	'message.completed',
	'tool.call',
	'tool.delta',
	'tool.result',
	'shell.job.updated',
	'shell.job.output',
	'plan.updated',
	'goal.updated',
	'finish-step',
	'usage',
	'queue.updated',
	'error',
	'heartbeat',
]);

export type ServerEventType = z.infer<typeof serverEventTypeSchema>;
/** @deprecated Use ServerEventType. */
export type OttoEventType = ServerEventType;

export interface ToolApprovalRequiredPayload {
	callId: string;
	toolName: string;
	args: unknown;
	messageId: string;
}

export interface ToolApprovalUpdatedPayload
	extends ToolApprovalRequiredPayload {}

export interface ToolApprovalResolvedPayload {
	callId: string;
	toolName: string;
	approved: boolean;
	reason: 'timeout' | 'user_approved' | 'user_rejected';
}

export interface SecureInputRequiredPayload {
	promptId: string;
	messageId: string;
	callId?: string;
	prompt: string;
	inputKind: 'text' | 'password';
	allowRemember: boolean;
}

export interface SecureInputResolvedPayload {
	promptId: string;
	messageId: string;
	callId?: string;
	cancelled: boolean;
	reason: 'timeout' | 'user_cancelled' | 'user_submitted';
}

export interface PaymentRequiredPayload {
	amountUsd: number;
	currentBalance?: number;
}

export interface PaymentCompletePayload {
	amountUsd: number;
	newBalance: number;
	transactionId?: string;
}

export interface BalanceUpdatedPayload {
	costUsd: number;
	balanceRemaining: number;
	inputTokens?: number;
	outputTokens?: number;
}

export interface PaymentErrorPayload {
	error: string;
}

export interface TopupRequiredPayload extends PaymentRequiredPayload {
	messageId?: string;
	currentBalance: number;
	minTopupUsd: number;
	suggestedTopupUsd: number;
}

export interface FiatCheckoutCreatedPayload {
	messageId: string;
	needsTopup: boolean;
}

export interface SessionPayload {
	id: string;
	[key: string]: unknown;
}

export interface MessageCreatedPayload {
	id: string;
	sessionId?: string;
	role?: 'user' | 'assistant' | 'system';
	status?: string;
	agent?: string;
	provider?: string;
	model?: string;
	createdAt?: string | number;
	completedAt?: string | number;
	content?: string;
	attachmentNames?: string[];
	providerStreamRetry?: boolean;
	maxOutputContinuation?: boolean;
	[key: string]: unknown;
}

export interface MessageUpdatedPayload {
	id: string;
	status: string;
	error?: string;
	[key: string]: unknown;
}

export interface MessagePartDeltaPayload {
	messageId: string;
	partId: string;
	stepIndex?: number;
	delta?: string;
	type?: string;
	content?: string;
}

export interface ReasoningDeltaPayload {
	messageId: string;
	partId: string;
	stepIndex: number;
	delta: string;
}

export interface MessageCompletedPayload {
	id: string;
	usage?: unknown;
	costUsd?: number;
	finishReason?: string;
	rawFinishReason?: string;
	autoCompacted?: boolean;
	providerStreamRetry?: boolean;
	fiatTopupRequired?: boolean;
	preemptedBy?: string;
	status?: string;
	[key: string]: unknown;
}

export interface BoundedEventValueMetadata {
	argsTruncated?: boolean;
	argsOriginalBytes?: number;
	resultTruncated?: boolean;
	resultOriginalBytes?: number;
	artifactTruncated?: boolean;
	artifactOriginalBytes?: number;
}

export interface ToolCallPayload extends BoundedEventValueMetadata {
	name: string;
	callId: string;
	messageId: string;
	args: unknown;
	stepIndex?: number;
	index?: number;
}

export interface ToolDeltaPayload {
	name: string;
	channel: string;
	delta: unknown;
	messageId: string;
	stepIndex?: number;
	callId?: string;
	deltaTruncated?: boolean;
	deltaOriginalBytes?: number;
}

export interface ToolResultPayload extends BoundedEventValueMetadata {
	name: string;
	messageId: string;
	result: unknown;
	callId?: string;
	stepIndex?: number;
	args?: unknown;
	artifact?: unknown;
}

export type ShellJobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ShellJobSnapshot {
	id: string;
	projectRoot?: string;
	sessionId: string;
	messageId: string;
	callId?: string;
	command: string;
	cwd: string;
	status: ShellJobStatus;
	detached: boolean;
	output: string;
	exitCode: number | null;
	result: unknown;
	reported: boolean;
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
}

export interface PlanItem {
	step: string;
	status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface PlanUpdatedPayload {
	items: PlanItem[];
	note?: string;
}

export interface GoalUpdatedPayload {
	goalId: string;
	changes: string[];
}

export interface FinishStepPayload {
	stepIndex?: number;
	usage?: unknown;
	finishReason?: string;
	response?: unknown;
	reason?: 'no-tool-calls';
}

export interface UsagePayload {
	stepIndex: number;
	[key: string]: unknown;
}

export interface QueueUpdatedPayload {
	currentMessageId: string | null;
	queuedMessages: unknown[];
	queueLength: number;
	isRunning: boolean;
}

export interface ErrorPayload {
	messageId: string;
	partId?: string;
	message?: string;
	type?: string;
	error?: string;
	errorType?: string;
	details?: unknown;
	isAborted: boolean;
	autoCompacted?: boolean;
	stepsCompleted?: number;
}

export interface ServerEventPayloadMap {
	'tool.approval.required': ToolApprovalRequiredPayload;
	'tool.approval.updated': ToolApprovalUpdatedPayload;
	'tool.approval.resolved': ToolApprovalResolvedPayload;
	'shell.secure_input.required': SecureInputRequiredPayload;
	'shell.secure_input.resolved': SecureInputResolvedPayload;
	'ottorouter.payment.required': PaymentRequiredPayload;
	'ottorouter.payment.signing': Record<string, never>;
	'ottorouter.payment.complete': PaymentCompletePayload;
	'ottorouter.payment.error': PaymentErrorPayload;
	'ottorouter.topup.required': TopupRequiredPayload;
	'ottorouter.topup.method_selected': { method: string };
	'ottorouter.topup.cancelled': { reason: string };
	'ottorouter.fiat.checkout_created': FiatCheckoutCreatedPayload;
	'ottorouter.balance.updated': BalanceUpdatedPayload;
	'session.created': SessionPayload;
	'session.deleted': { id: string };
	'session.updated': SessionPayload;
	'message.created': MessageCreatedPayload;
	'message.updated': MessageUpdatedPayload;
	'message.part.delta': MessagePartDeltaPayload;
	'reasoning.delta': ReasoningDeltaPayload;
	'message.completed': MessageCompletedPayload;
	'tool.call': ToolCallPayload;
	'tool.delta': ToolDeltaPayload;
	'tool.result': ToolResultPayload;
	'shell.job.updated': { job: ShellJobSnapshot };
	'shell.job.output': { jobId: string; delta: string; updatedAt: number };
	'plan.updated': PlanUpdatedPayload;
	'goal.updated': GoalUpdatedPayload;
	'finish-step': FinishStepPayload;
	usage: UsagePayload;
	'queue.updated': QueueUpdatedPayload;
	error: ErrorPayload;
	heartbeat: { createdAt: string };
}

export type ServerEvent<T extends ServerEventType = ServerEventType> =
	T extends ServerEventType
		? {
				type: T;
				sessionId: string;
				projectId?: string;
				projectRoot?: string;
				payload: ServerEventPayloadMap[T];
			}
		: never;

/** @deprecated Use ServerEvent. */
export type OttoEvent<T extends ServerEventType = ServerEventType> =
	ServerEvent<T>;

const objectPayload = z.looseObject({});
const idPayload = z.looseObject({ id: z.string().min(1) });
const messagePartPayload = z.looseObject({
	messageId: z.string().min(1),
	partId: z.string().min(1),
});

const payloadSchemas: Record<ServerEventType, z.ZodType> = {
	'tool.approval.required': z.looseObject({
		callId: z.string().min(1),
		toolName: z.string().min(1),
		args: z.unknown(),
		messageId: z.string().min(1),
	}),
	'tool.approval.updated': z.looseObject({
		callId: z.string().min(1),
		toolName: z.string().min(1),
		args: z.unknown(),
		messageId: z.string().min(1),
	}),
	'tool.approval.resolved': z.looseObject({
		callId: z.string().min(1),
		toolName: z.string().min(1),
		approved: z.boolean(),
		reason: z.enum(['timeout', 'user_approved', 'user_rejected']),
	}),
	'shell.secure_input.required': z.looseObject({
		promptId: z.string().min(1),
		messageId: z.string().min(1),
		prompt: z.string(),
		inputKind: z.enum(['text', 'password']),
		allowRemember: z.boolean(),
	}),
	'shell.secure_input.resolved': z.looseObject({
		promptId: z.string().min(1),
		messageId: z.string().min(1),
		cancelled: z.boolean(),
		reason: z.enum(['timeout', 'user_cancelled', 'user_submitted']),
	}),
	'ottorouter.payment.required': z.looseObject({
		amountUsd: z.number(),
		currentBalance: z.number().optional(),
	}),
	'ottorouter.payment.signing': objectPayload,
	'ottorouter.payment.complete': z.looseObject({
		amountUsd: z.number(),
		newBalance: z.number(),
	}),
	'ottorouter.payment.error': z.looseObject({ error: z.string() }),
	'ottorouter.topup.required': z.looseObject({
		amountUsd: z.number(),
		currentBalance: z.number(),
		minTopupUsd: z.number(),
		suggestedTopupUsd: z.number(),
	}),
	'ottorouter.topup.method_selected': z.looseObject({ method: z.string() }),
	'ottorouter.topup.cancelled': z.looseObject({ reason: z.string() }),
	'ottorouter.fiat.checkout_created': z.looseObject({
		messageId: z.string().min(1),
		needsTopup: z.boolean(),
	}),
	'ottorouter.balance.updated': z.looseObject({
		costUsd: z.number(),
		balanceRemaining: z.number(),
	}),
	'session.created': idPayload,
	'session.deleted': idPayload,
	'session.updated': idPayload,
	'message.created': idPayload,
	'message.updated': z.looseObject({
		id: z.string().min(1),
		status: z.string().min(1),
	}),
	'message.part.delta': messagePartPayload,
	'reasoning.delta': messagePartPayload.extend({
		stepIndex: z.number().int(),
		delta: z.string(),
	}),
	'message.completed': idPayload,
	'tool.call': z.looseObject({
		name: z.string().min(1),
		callId: z.string().min(1),
		messageId: z.string().min(1),
		args: z.unknown(),
	}),
	'tool.delta': z.looseObject({
		name: z.string().min(1),
		channel: z.string().min(1),
		delta: z.unknown(),
		messageId: z.string().min(1),
	}),
	'tool.result': z.looseObject({
		name: z.string().min(1),
		messageId: z.string().min(1),
		result: z.unknown(),
	}),
	'shell.job.updated': z.looseObject({ job: objectPayload }),
	'shell.job.output': z.looseObject({
		jobId: z.string().min(1),
		delta: z.string(),
		updatedAt: z.number(),
	}),
	'plan.updated': z.looseObject({
		items: z.array(
			z.object({
				step: z.string().min(1),
				status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
			}),
		),
	}),
	'goal.updated': z.looseObject({
		goalId: z.string().min(1),
		changes: z.array(z.string()),
	}),
	'finish-step': objectPayload,
	usage: z.looseObject({ stepIndex: z.number().int() }),
	'queue.updated': z.looseObject({
		currentMessageId: z.string().nullable(),
		queuedMessages: z.array(z.unknown()),
		queueLength: z.number().int().nonnegative(),
		isRunning: z.boolean(),
	}),
	error: z.looseObject({
		messageId: z.string().min(1),
		isAborted: z.boolean(),
	}),
	heartbeat: z.looseObject({ createdAt: z.string().min(1) }),
};

const serverEventEnvelopeSchema = z.object({
	type: serverEventTypeSchema,
	sessionId: z.string().min(1),
	projectId: z.string().optional(),
	projectRoot: z.string().optional(),
	payload: z.unknown(),
});

function isValidServerEvent(value: unknown): value is ServerEvent {
	const envelope = serverEventEnvelopeSchema.safeParse(value);
	return (
		envelope.success &&
		payloadSchemas[envelope.data.type].safeParse(envelope.data.payload).success
	);
}

export const serverEventSchema = z.custom<ServerEvent>(isValidServerEvent, {
	message: 'Invalid server event envelope or payload',
});

export function parseServerEvent(value: unknown): ServerEvent {
	return serverEventSchema.parse(value);
}

export function parseServerEventJson(raw: string): ServerEvent {
	return parseServerEvent(JSON.parse(raw));
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

const notificationEventSchema = z.object({
	id: z.string().min(1),
	level: z.enum(['info', 'success', 'warning', 'error']),
	title: z.string().min(1),
	body: z.string().optional(),
	action: z.object({ label: z.string(), href: z.string() }).optional(),
	createdAt: z.string().min(1),
	expiresAt: z.string().optional(),
	source: z.enum(['agent', 'system', 'session', 'auth', 'billing']).optional(),
	sessionId: z.string().optional(),
	projectId: z.string().optional(),
	projectRoot: z.string().optional(),
});

const sessionStatusEventSchema = z.object({
	sessionId: z.string().min(1),
	projectId: z.string().optional(),
	projectRoot: z.string().optional(),
	status: z.enum(['running', 'completed', 'failed', 'needs_attention']),
	messageId: z.string().optional(),
	createdAt: z.string().min(1),
});

const referencePreparationEventSchema = z.object({
	name: z.string().min(1),
	url: z.string().min(1),
	ref: z.string().optional(),
	projectRoot: z.string().min(1),
	status: z.enum(['cloning', 'available', 'error']),
	error: z.string().optional(),
	output: z.array(z.string()).optional(),
});

export const clientEventSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('notification'),
		payload: notificationEventSchema,
	}),
	z.object({
		type: z.literal('session.status'),
		payload: sessionStatusEventSchema,
	}),
	z.object({
		type: z.literal('reference.preparation'),
		payload: referencePreparationEventSchema,
	}),
	z.object({
		type: z.literal('heartbeat'),
		payload: z.object({ createdAt: z.string().min(1) }),
	}),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;

export function parseClientEvent(value: unknown): ClientEvent {
	return clientEventSchema.parse(value);
}

export function parseClientEventJson(raw: string): ClientEvent {
	return parseClientEvent(JSON.parse(raw));
}
