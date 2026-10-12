import { z } from 'zod';

const id = z.string().min(1);
const stepIndex = z.number().int().optional();
const boundedEventValueMetadataSchema = z.object({
	argsTruncated: z.boolean().optional(),
	argsOriginalBytes: z.number().optional(),
	resultTruncated: z.boolean().optional(),
	resultOriginalBytes: z.number().optional(),
	artifactTruncated: z.boolean().optional(),
	artifactOriginalBytes: z.number().optional(),
});
const approvalRequiredSchema = z.looseObject({
	callId: id,
	toolName: id,
	args: z.unknown(),
	messageId: id,
});
const paymentRequiredSchema = z.looseObject({
	amountUsd: z.number(),
	currentBalance: z.number().optional(),
});
const idPayload = z.looseObject({ id });
export const shellJobStatusSchema = z.enum([
	'running',
	'completed',
	'failed',
	'cancelled',
]);
export const shellJobSnapshotSchema = z.object({
	id,
	projectRoot: z.string().optional(),
	sessionId: id,
	messageId: id,
	callId: z.string().optional(),
	command: z.string(),
	cwd: z.string(),
	status: shellJobStatusSchema,
	detached: z.boolean(),
	output: z.string(),
	exitCode: z.number().nullable(),
	result: z.unknown(),
	reported: z.boolean(),
	createdAt: z.number(),
	updatedAt: z.number(),
	completedAt: z.number().nullable(),
});
const planItemSchema = z.object({
	step: id,
	status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

export const serverEventPayloadSchemas = {
	'tool.approval.required': approvalRequiredSchema,
	'tool.approval.updated': approvalRequiredSchema,
	'tool.approval.resolved': z.looseObject({
		callId: id,
		toolName: id,
		approved: z.boolean(),
		reason: z.enum(['timeout', 'user_approved', 'user_rejected']),
	}),
	'shell.secure_input.required': z.looseObject({
		promptId: id,
		messageId: id,
		callId: z.string().optional(),
		prompt: z.string(),
		inputKind: z.enum(['text', 'password']),
		allowRemember: z.boolean(),
	}),
	'shell.secure_input.resolved': z.looseObject({
		promptId: id,
		messageId: id,
		callId: z.string().optional(),
		cancelled: z.boolean(),
		reason: z.enum(['timeout', 'user_cancelled', 'user_submitted']),
	}),
	'ottorouter.payment.required': paymentRequiredSchema,
	'ottorouter.payment.signing': z.object({}),
	'ottorouter.payment.complete': z.looseObject({
		amountUsd: z.number(),
		newBalance: z.number(),
		transactionId: z.string().optional(),
	}),
	'ottorouter.payment.error': z.looseObject({ error: z.string() }),
	'ottorouter.topup.required': paymentRequiredSchema.extend({
		messageId: z.string().optional(),
		currentBalance: z.number(),
		minTopupUsd: z.number(),
		suggestedTopupUsd: z.number(),
	}),
	'ottorouter.topup.method_selected': z.looseObject({ method: z.string() }),
	'ottorouter.topup.cancelled': z.looseObject({ reason: z.string() }),
	'ottorouter.fiat.checkout_created': z.looseObject({
		messageId: id,
		needsTopup: z.boolean(),
	}),
	'ottorouter.balance.updated': z.looseObject({
		costUsd: z.number(),
		balanceRemaining: z.number(),
		inputTokens: z.number().optional(),
		outputTokens: z.number().optional(),
	}),
	'session.created': idPayload,
	'session.deleted': z.object({ id }),
	'session.updated': idPayload,
	'message.created': idPayload.extend({
		sessionId: z.string().optional(),
		role: z.enum(['user', 'assistant', 'system']).optional(),
		status: z.string().optional(),
		agent: z.string().optional(),
		provider: z.string().optional(),
		model: z.string().optional(),
		createdAt: z.union([z.string(), z.number()]).optional(),
		completedAt: z.union([z.string(), z.number()]).optional(),
		content: z.string().optional(),
		attachmentNames: z.array(z.string()).optional(),
		providerStreamRetry: z.boolean().optional(),
		maxOutputContinuation: z.boolean().optional(),
	}),
	'message.updated': idPayload.extend({
		status: id,
		error: z.string().optional(),
	}),
	'message.part.delta': z.looseObject({
		messageId: id,
		partId: id,
		stepIndex,
		delta: z.string().optional(),
		type: z.string().optional(),
		content: z.string().optional(),
	}),
	'reasoning.delta': z.looseObject({
		messageId: id,
		partId: id,
		stepIndex: z.number().int(),
		delta: z.string(),
	}),
	'message.completed': idPayload.extend({
		usage: z.unknown().optional(),
		costUsd: z.number().optional(),
		finishReason: z.string().optional(),
		rawFinishReason: z.string().optional(),
		autoCompacted: z.boolean().optional(),
		providerStreamRetry: z.boolean().optional(),
		fiatTopupRequired: z.boolean().optional(),
		preemptedBy: z.string().optional(),
		status: z.string().optional(),
	}),
	'tool.call': z.looseObject({
		...boundedEventValueMetadataSchema.shape,
		name: id,
		callId: id,
		messageId: id,
		args: z.unknown(),
		stepIndex,
		index: z.number().optional(),
	}),
	'tool.delta': z.looseObject({
		name: id,
		channel: id,
		delta: z.unknown(),
		messageId: id,
		stepIndex,
		callId: z.string().optional(),
		deltaTruncated: z.boolean().optional(),
		deltaOriginalBytes: z.number().optional(),
	}),
	'tool.result': z.looseObject({
		...boundedEventValueMetadataSchema.shape,
		name: id,
		messageId: id,
		result: z.unknown(),
		callId: z.string().optional(),
		stepIndex,
		args: z.unknown().optional(),
		artifact: z.unknown().optional(),
	}),
	'shell.job.updated': z.looseObject({ job: shellJobSnapshotSchema }),
	'shell.job.output': z.looseObject({
		jobId: id,
		delta: z.string(),
		updatedAt: z.number(),
	}),
	'plan.updated': z.looseObject({
		items: z.array(planItemSchema),
		note: z.string().optional(),
	}),
	'goal.updated': z.looseObject({ goalId: id, changes: z.array(z.string()) }),
	'finish-step': z.looseObject({
		stepIndex,
		usage: z.unknown().optional(),
		finishReason: z.string().optional(),
		response: z.unknown().optional(),
		reason: z.literal('no-tool-calls').optional(),
	}),
	usage: z.looseObject({ stepIndex: z.number().int() }),
	'queue.updated': z.looseObject({
		currentMessageId: z.string().nullable(),
		queuedMessages: z.array(z.unknown()),
		queueLength: z.number().int().nonnegative(),
		isRunning: z.boolean(),
	}),
	error: z.looseObject({
		messageId: id,
		partId: z.string().optional(),
		message: z.string().optional(),
		type: z.string().optional(),
		error: z.string().optional(),
		errorType: z.string().optional(),
		details: z.unknown().optional(),
		isAborted: z.boolean(),
		autoCompacted: z.boolean().optional(),
		stepsCompleted: z.number().optional(),
	}),
	heartbeat: z.looseObject({ createdAt: id }),
};

export const serverEventTypeSchema = z.enum(
	Object.keys(serverEventPayloadSchemas) as [
		keyof typeof serverEventPayloadSchemas,
		...(keyof typeof serverEventPayloadSchemas)[],
	],
);
export type ServerEventType = z.infer<typeof serverEventTypeSchema>;
/** @deprecated Use ServerEventType. */
export type OttoEventType = ServerEventType;
export type ServerEventPayloadMap = {
	[T in ServerEventType]: z.infer<(typeof serverEventPayloadSchemas)[T]>;
};

function eventVariant<T extends ServerEventType>(type: T) {
	return z.object({
		type: z.literal(type),
		sessionId: id,
		projectId: z.string().optional(),
		projectRoot: z.string().optional(),
		payload: serverEventPayloadSchemas[type],
	});
}

// The tuple preserves each discriminator's payload type when constructing the union.
const eventVariants = <
	T extends readonly [ServerEventType, ...ServerEventType[]],
>(
	...types: T
) =>
	types.map((type) => eventVariant(type)) as {
		[K in keyof T]: ReturnType<typeof eventVariant<T[K]>>;
	};
export const serverEventSchema = z.discriminatedUnion(
	'type',
	eventVariants(
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
	),
);
export type ServerEvent<T extends ServerEventType = ServerEventType> = Extract<
	z.infer<typeof serverEventSchema>,
	{ type: T }
>;
/** @deprecated Use ServerEvent. */
export type OttoEvent<T extends ServerEventType = ServerEventType> =
	ServerEvent<T>;

export type ToolApprovalRequiredPayload =
	ServerEventPayloadMap['tool.approval.required'];
export type ToolApprovalUpdatedPayload =
	ServerEventPayloadMap['tool.approval.updated'];
export type ToolApprovalResolvedPayload =
	ServerEventPayloadMap['tool.approval.resolved'];
export type SecureInputRequiredPayload =
	ServerEventPayloadMap['shell.secure_input.required'];
export type SecureInputResolvedPayload =
	ServerEventPayloadMap['shell.secure_input.resolved'];
export type PaymentRequiredPayload =
	ServerEventPayloadMap['ottorouter.payment.required'];
export type PaymentCompletePayload =
	ServerEventPayloadMap['ottorouter.payment.complete'];
export type BalanceUpdatedPayload =
	ServerEventPayloadMap['ottorouter.balance.updated'];
export type PaymentErrorPayload =
	ServerEventPayloadMap['ottorouter.payment.error'];
export type TopupRequiredPayload =
	ServerEventPayloadMap['ottorouter.topup.required'];
export type FiatCheckoutCreatedPayload =
	ServerEventPayloadMap['ottorouter.fiat.checkout_created'];
export type SessionPayload = ServerEventPayloadMap['session.created'];
export type MessageCreatedPayload = ServerEventPayloadMap['message.created'];
export type MessageUpdatedPayload = ServerEventPayloadMap['message.updated'];
export type MessagePartDeltaPayload =
	ServerEventPayloadMap['message.part.delta'];
export type ReasoningDeltaPayload = ServerEventPayloadMap['reasoning.delta'];
export type MessageCompletedPayload =
	ServerEventPayloadMap['message.completed'];
export type BoundedEventValueMetadata = z.infer<
	typeof boundedEventValueMetadataSchema
>;
export type ToolCallPayload = ServerEventPayloadMap['tool.call'];
export type ToolDeltaPayload = ServerEventPayloadMap['tool.delta'];
export type ToolResultPayload = ServerEventPayloadMap['tool.result'];
export type ShellJobStatus = z.infer<typeof shellJobStatusSchema>;
export type ShellJobSnapshot = z.infer<typeof shellJobSnapshotSchema>;
export type PlanItem = z.infer<typeof planItemSchema>;
export type PlanUpdatedPayload = ServerEventPayloadMap['plan.updated'];
export type GoalUpdatedPayload = ServerEventPayloadMap['goal.updated'];
export type FinishStepPayload = ServerEventPayloadMap['finish-step'];
export type UsagePayload = ServerEventPayloadMap['usage'];
export type QueueUpdatedPayload = ServerEventPayloadMap['queue.updated'];
export type ErrorPayload = ServerEventPayloadMap['error'];

export function parseServerEvent(value: unknown): ServerEvent {
	return serverEventSchema.parse(value);
}
export function parseServerEventJson(raw: string): ServerEvent {
	return parseServerEvent(JSON.parse(raw));
}

const notificationEventSchema = z.object({
	id,
	level: z.enum(['info', 'success', 'warning', 'error']),
	title: id,
	body: z.string().optional(),
	action: z.object({ label: z.string(), href: z.string() }).optional(),
	createdAt: id,
	expiresAt: z.string().optional(),
	source: z.enum(['agent', 'system', 'session', 'auth', 'billing']).optional(),
	sessionId: z.string().optional(),
	projectId: z.string().optional(),
	projectRoot: z.string().optional(),
});
const sessionStatusEventSchema = z.object({
	sessionId: id,
	projectId: z.string().optional(),
	projectRoot: z.string().optional(),
	status: z.enum(['running', 'completed', 'failed', 'needs_attention']),
	messageId: z.string().optional(),
	createdAt: id,
});
const referencePreparationEventSchema = z.object({
	name: id,
	url: id,
	ref: z.string().optional(),
	projectRoot: id,
	status: z.enum(['cloning', 'available', 'error']),
	error: z.string().optional(),
	output: z.array(z.string()).optional(),
});
export type NotificationEvent = z.infer<typeof notificationEventSchema>;
export type NotificationLevel = NotificationEvent['level'];
export type NotificationAction = NonNullable<NotificationEvent['action']>;
export type SessionStatusEvent = z.infer<typeof sessionStatusEventSchema>;
export type ReferencePreparationEvent = z.infer<
	typeof referencePreparationEventSchema
>;
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
		payload: z.object({ createdAt: id }),
	}),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;
export function parseClientEvent(value: unknown): ClientEvent {
	return clientEventSchema.parse(value);
}
export function parseClientEventJson(raw: string): ClientEvent {
	return parseClientEvent(JSON.parse(raw));
}

export const replayMissedSchema = z.object({ lastEventId: z.string() });
export const truncatedPayloadSchema = z.looseObject({
	streamPayloadTruncated: z.literal(true),
	streamPayloadOriginalBytes: z.number().optional(),
	streamPayloadOmitted: z.boolean().optional(),
});
export type ReplayMissedPayload = z.infer<typeof replayMissedSchema>;
export type TruncatedStreamPayload = z.infer<typeof truncatedPayloadSchema>;
