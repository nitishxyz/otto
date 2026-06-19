import type { FilePart, TextPart } from 'ai';
import { preprocessFileMentionsForModel } from '../file-mentions.ts';
import type { MessagePartRow, MessageRow } from './types.ts';

function formatAttachmentContext(args: {
	kind: string;
	name?: string;
	mediaType?: string;
	attachmentId?: string;
	original?: { filename?: string; size?: number; sha256?: string };
}): string | undefined {
	const name = args.name || args.original?.filename || 'attachment';
	if (!args.attachmentId) return undefined;
	const details = [
		`${args.kind} attachment`,
		`name: ${name}`,
		args.mediaType ? `mediaType: ${args.mediaType}` : undefined,
		`attachmentId: ${args.attachmentId}`,
		args.original?.size ? `originalBytes: ${args.original.size}` : undefined,
	].filter(Boolean);
	return `[${details.join('; ')}]`;
}

export function findLatestUserImageMessageId(
	rows: MessageRow[],
	partsByMessageId: Map<string, MessagePartRow[]>,
): string | undefined {
	for (let index = rows.length - 1; index >= 0; index--) {
		const row = rows[index];
		if (row.role !== 'user') continue;
		const parts = partsByMessageId.get(row.id) ?? [];
		if (parts.some((part) => part.type === 'image')) return row.id;
	}
	return undefined;
}

export async function buildUserModelParts(args: {
	message: MessageRow;
	parts: MessagePartRow[];
	latestUserImageMessageId?: string;
	projectRoot?: string;
}): Promise<Array<TextPart | FilePart>> {
	const userParts: Array<TextPart | FilePart> = [];
	for (const part of args.parts) {
		if (part.type === 'text') {
			await appendTextPart(userParts, part, args.projectRoot);
		} else if (part.type === 'image') {
			appendImagePart(userParts, part, {
				isLatestUserImageMessage:
					args.message.id === args.latestUserImageMessageId,
			});
		} else if (part.type === 'file') {
			appendFilePart(userParts, part, {
				isLatestUserImageMessage:
					args.message.id === args.latestUserImageMessageId,
			});
		}
	}
	return userParts;
}

async function appendTextPart(
	userParts: Array<TextPart | FilePart>,
	part: MessagePartRow,
	projectRoot?: string,
) {
	try {
		const obj = JSON.parse(part.content ?? '{}');
		const text = String(obj.text ?? '');
		if (!text) return;
		const preprocessed = await preprocessFileMentionsForModel({
			text,
			projectRoot,
		});
		userParts.push({ type: 'text', text: preprocessed.text });
	} catch {}
}

function appendImagePart(
	userParts: Array<TextPart | FilePart>,
	part: MessagePartRow,
	args: { isLatestUserImageMessage: boolean },
) {
	try {
		const obj = JSON.parse(part.content ?? '{}') as {
			data?: string;
			mediaType?: string;
			attachmentId?: string;
			name?: string;
			original?: { filename?: string; size?: number; sha256?: string };
		};
		const attachmentContext = formatAttachmentContext({
			kind: 'image',
			name: obj.name,
			mediaType: obj.mediaType,
			attachmentId: obj.attachmentId,
			original: obj.original,
		});
		if (attachmentContext) {
			userParts.push({ type: 'text', text: attachmentContext });
		}
		if (args.isLatestUserImageMessage && obj.data && obj.mediaType) {
			userParts.push({
				type: 'file',
				data: obj.data,
				...(obj.name ? { filename: obj.name } : {}),
				mediaType: obj.mediaType,
			});
		}
	} catch {}
}

function appendFilePart(
	userParts: Array<TextPart | FilePart>,
	part: MessagePartRow,
	args: { isLatestUserImageMessage: boolean },
) {
	try {
		const obj = JSON.parse(part.content ?? '{}') as {
			type?: 'image' | 'pdf' | 'text' | 'binary';
			name?: string;
			data?: string;
			mediaType?: string;
			textContent?: string;
			attachmentId?: string;
			original?: { filename?: string; size?: number; sha256?: string };
		};
		if (obj.type === 'text' && obj.textContent) {
			userParts.push({
				type: 'text',
				text: `<file name="${obj.name || 'file'}">\n${obj.textContent}\n</file>`,
			});
		} else if (obj.type === 'pdf' && obj.data && obj.mediaType) {
			appendPdfFilePart(userParts, obj);
		} else if (obj.type === 'image') {
			appendImageFilePart(userParts, obj, args);
		}
	} catch {}
}

function appendPdfFilePart(
	userParts: Array<TextPart | FilePart>,
	obj: {
		name?: string;
		data?: string;
		mediaType?: string;
		attachmentId?: string;
		original?: { filename?: string; size?: number; sha256?: string };
	},
) {
	const attachmentContext = formatAttachmentContext({
		kind: 'pdf',
		name: obj.name,
		mediaType: obj.mediaType,
		attachmentId: obj.attachmentId,
		original: obj.original,
	});
	if (attachmentContext) {
		userParts.push({ type: 'text', text: attachmentContext });
	}
	userParts.push({
		type: 'file',
		data: obj.data as string,
		filename: obj.name,
		mediaType: obj.mediaType as string,
	});
}

function appendImageFilePart(
	userParts: Array<TextPart | FilePart>,
	obj: {
		name?: string;
		data?: string;
		mediaType?: string;
		attachmentId?: string;
		original?: { filename?: string; size?: number; sha256?: string };
	},
	args: { isLatestUserImageMessage: boolean },
) {
	const attachmentContext = formatAttachmentContext({
		kind: 'image',
		name: obj.name,
		mediaType: obj.mediaType,
		attachmentId: obj.attachmentId,
		original: obj.original,
	});
	if (attachmentContext) {
		userParts.push({ type: 'text', text: attachmentContext });
	}
	if (!(obj.data && obj.mediaType && args.isLatestUserImageMessage)) return;
	userParts.push({
		type: 'file',
		data: obj.data,
		filename: obj.name,
		mediaType: obj.mediaType,
	});
}
