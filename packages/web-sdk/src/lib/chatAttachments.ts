import type {
	FileAttachment,
	UploadedAttachment,
} from '../hooks/useFileUpload';
import type { ChatDraftAttachment } from '../stores/chatDraftStore';
import type { Message } from '../types/api';

interface MessageAttachmentData {
	type?: ChatDraftAttachment['type'];
	name?: string;
	mediaType?: string;
	attachmentId?: string;
	original?: {
		filename?: string;
		size?: number;
		sha256?: string;
		mimeType?: string;
	};
}

function parsePartContent(
	content: string,
	contentJson?: Record<string, unknown>,
) {
	if (contentJson) return contentJson;
	try {
		const parsed: unknown = JSON.parse(content || '{}');
		return parsed && typeof parsed === 'object'
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

export function toChatDraftAttachment(
	attachment: FileAttachment,
): ChatDraftAttachment | undefined {
	const uploaded = attachment.uploadedAttachment;
	if (attachment.uploadStatus !== 'ready' || !uploaded) return undefined;
	return {
		id: attachment.id,
		type: attachment.type,
		name: attachment.name,
		mediaType: attachment.mediaType,
		attachmentId: uploaded.id,
		original: {
			filename: uploaded.filename,
			size: uploaded.size,
			sha256: uploaded.sha256,
			mimeType: uploaded.mimeType,
		},
	};
}

export function fromChatDraftAttachment(
	attachment: ChatDraftAttachment,
): FileAttachment {
	const uploadedAttachment: UploadedAttachment = {
		id: attachment.attachmentId,
		filename: attachment.original.filename,
		mimeType: attachment.original.mimeType,
		size: attachment.original.size,
		sha256: attachment.original.sha256,
		kind: attachment.type,
		originalPath: '',
		originalUrl: '',
		metadataUrl: '',
		status: 'ready',
	};
	return {
		id: attachment.id,
		file: new File([], attachment.name, { type: attachment.mediaType }),
		type: attachment.type,
		name: attachment.name,
		mediaType: attachment.mediaType,
		uploadStatus: 'ready',
		uploadedAttachment,
	};
}

export function getMessageChatDraftAttachments(
	message: Message | undefined,
): ChatDraftAttachment[] {
	if (!message) return [];
	return (message.parts ?? []).flatMap((part) => {
		if (part.type !== 'image' && part.type !== 'file') return [];
		const content = parsePartContent(part.content, part.contentJson) as
			| MessageAttachmentData
			| undefined;
		if (!content?.attachmentId) return [];
		const type = content.type ?? (part.type === 'image' ? 'image' : 'binary');
		const name = content.name ?? content.original?.filename ?? 'attachment';
		const mediaType =
			content.mediaType ??
			content.original?.mimeType ??
			'application/octet-stream';
		return [
			{
				id: part.id,
				type,
				name,
				mediaType,
				attachmentId: content.attachmentId,
				original: {
					filename: content.original?.filename ?? name,
					size: content.original?.size ?? 0,
					sha256: content.original?.sha256 ?? '',
					mimeType: content.original?.mimeType ?? mediaType,
				},
			},
		];
	});
}
