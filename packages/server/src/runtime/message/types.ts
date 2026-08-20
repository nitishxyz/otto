import type { DB } from '@ottocode/database';
import type { sessions } from '@ottocode/database/schema';
import type { OttoConfig, ProviderId, ReasoningLevel } from '@ottocode/sdk';
import type { ImageCompressionMetadata } from './image-compression.ts';

export type ContextFileReference = {
	path: string;
	startLine?: number;
	endLine?: number;
	maxLines?: number;
};

export type MessageContext = {
	files: ContextFileReference[];
};

export type AttachmentOriginalMetadata = {
	filename?: string;
	size?: number;
	sha256?: string;
	mimeType?: string;
};

export type SessionRow = typeof sessions.$inferSelect;

export type DispatchOptions = {
	cfg: OttoConfig;
	db: DB;
	session: SessionRow;
	agent: string;
	provider: ProviderId;
	model: string;
	content: string;
	oneShot?: boolean;
	userContext?: string;
	reasoningText?: boolean;
	reasoningLevel?: ReasoningLevel;
	images?: Array<{
		data: string;
		mediaType: string;
		name?: string;
		attachmentId?: string;
		original?: AttachmentOriginalMetadata;
		compression?: ImageCompressionMetadata;
	}>;
	files?: Array<{
		type: 'image' | 'pdf' | 'text' | 'binary';
		name: string;
		data?: string;
		mediaType: string;
		compression?: ImageCompressionMetadata;
		textContent?: string;
		attachmentId?: string;
		original?: AttachmentOriginalMetadata;
	}>;
	context?: MessageContext;
};
