import { relations } from 'drizzle-orm';
export { sessions } from './sessions.ts';
export { messages } from './messages.ts';
export { messageParts } from './message-parts.ts';
export { artifacts } from './artifacts.ts';
export { shares } from './shares.ts';
export { subagents } from './subagents.ts';
export { goals } from './goals.ts';
export { goalTasks } from './goal-tasks.ts';

import { sessions } from './sessions.ts';
import { messages } from './messages.ts';
import { messageParts } from './message-parts.ts';
import { artifacts } from './artifacts.ts';
import { shares } from './shares.ts';
import { subagents } from './subagents.ts';
import { goals } from './goals.ts';
import { goalTasks } from './goal-tasks.ts';

export const sessionsRelations = relations(sessions, ({ many }) => ({
	messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
	session: one(sessions, {
		fields: [messages.sessionId],
		references: [sessions.id],
	}),
	parts: many(messageParts),
}));

export const messagePartsRelations = relations(messageParts, ({ one }) => ({
	message: one(messages, {
		fields: [messageParts.messageId],
		references: [messages.id],
	}),
}));

export const artifactsRelations = relations(artifacts, ({ one }) => ({
	part: one(messageParts, {
		fields: [artifacts.messagePartId],
		references: [messageParts.id],
	}),
}));

export const sharesRelations = relations(shares, ({ one }) => ({
	session: one(sessions, {
		fields: [shares.sessionId],
		references: [sessions.id],
	}),
}));

export const subagentsRelations = relations(subagents, ({ one }) => ({
	parentSession: one(sessions, {
		fields: [subagents.parentSessionId],
		references: [sessions.id],
	}),
	childSession: one(sessions, {
		fields: [subagents.childSessionId],
		references: [sessions.id],
	}),
}));

export const goalsRelations = relations(goals, ({ one, many }) => ({
	session: one(sessions, {
		fields: [goals.sessionId],
		references: [sessions.id],
	}),
	tasks: many(goalTasks),
}));

export const goalTasksRelations = relations(goalTasks, ({ one }) => ({
	goal: one(goals, {
		fields: [goalTasks.goalId],
		references: [goals.id],
	}),
}));
