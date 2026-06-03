import {
	useState,
	useCallback,
	useEffect,
	type DragEvent,
	type ClipboardEvent,
} from 'react';
import { uploadAttachment } from '@ottocode/api';
import { extractErrorMessage } from '../lib/api-client/utils';

export type FileAttachmentType = 'image' | 'pdf' | 'text' | 'binary';
export type FileUploadStatus = 'uploading' | 'ready' | 'failed';

export interface UploadedAttachment {
	id: string;
	filename: string;
	mimeType: string;
	size: number;
	sha256: string;
	kind: FileAttachmentType;
	originalPath: string;
	originalUrl: string;
	metadataUrl: string;
	status: 'ready';
}

export interface FileAttachment {
	id: string;
	file: File;
	type: FileAttachmentType;
	name: string;
	preview?: string;
	data?: string;
	mediaType: string;
	textContent?: string;
	uploadStatus: FileUploadStatus;
	uploadedAttachment?: UploadedAttachment;
	uploadError?: string;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const PDF_TYPES = ['application/pdf'];
const TEXT_TYPES = [
	'text/plain',
	'text/markdown',
	'text/x-markdown',
	'application/json',
	'text/csv',
	'text/xml',
	'application/xml',
	'text/yaml',
	'text/x-yaml',
	'application/x-yaml',
	'text/html',
	'text/css',
	'text/javascript',
	'application/javascript',
	'application/typescript',
];
const TEXT_EXTENSIONS = [
	'.txt',
	'.md',
	'.markdown',
	'.json',
	'.csv',
	'.xml',
	'.yaml',
	'.yml',
	'.html',
	'.css',
	'.js',
	'.ts',
	'.jsx',
	'.tsx',
	'.py',
	'.rs',
	'.go',
	'.java',
	'.c',
	'.cpp',
	'.h',
	'.hpp',
	'.rb',
	'.php',
	'.sh',
	'.bash',
	'.zsh',
	'.toml',
	'.ini',
	'.cfg',
	'.env',
	'.log',
	'.sql',
	'.graphql',
	'.svelte',
	'.vue',
];

function generateId(): string {
	return `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getExtension(file: File): string {
	const index = file.name.lastIndexOf('.');
	return index >= 0 ? file.name.toLowerCase().slice(index) : '';
}

function getFileType(file: File): FileAttachmentType {
	if (IMAGE_TYPES.includes(file.type)) return 'image';
	if (PDF_TYPES.includes(file.type)) return 'pdf';
	if (TEXT_TYPES.includes(file.type)) return 'text';
	if (TEXT_EXTENSIONS.includes(getExtension(file))) return 'text';
	return 'binary';
}

async function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			const base64 = result.split(',')[1];
			resolve(base64);
		};
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

async function fileToText(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsText(file);
	});
}

async function fileToPreview(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

async function uploadOriginalFile(
	file: File,
	sessionId?: string,
): Promise<UploadedAttachment> {
	const response = await uploadAttachment({
		body: {
			file,
			...(sessionId ? { sessionId } : {}),
		},
	});
	if (response.error) {
		throw new Error(extractErrorMessage(response.error));
	}
	return response.data as UploadedAttachment;
}

interface UseFileUploadOptions {
	maxFiles?: number;
	maxSizeMB?: number;
	pageWide?: boolean;
	supportsImages?: boolean;
	supportsFileAttachments?: boolean;
	sessionId?: string;
	onError?: (message: string) => void;
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
	const {
		maxFiles = 10,
		maxSizeMB = 100,
		pageWide = true,
		supportsImages = true,
		supportsFileAttachments = true,
		sessionId,
		onError,
	} = options;

	const [files, setFiles] = useState<FileAttachment[]>([]);
	const [isDragging, setIsDragging] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const maxSizeBytes = maxSizeMB * 1024 * 1024;

	const validateFile = useCallback(
		(file: File): string | null => {
			if (file.size > maxSizeBytes) {
				return `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: ${maxSizeMB}MB`;
			}
			return null;
		},
		[maxSizeBytes, maxSizeMB],
	);

	const addFiles = useCallback(
		async (inputFiles: FileList | File[]) => {
			setError(null);
			const fileArray = Array.from(inputFiles);
			const remaining = maxFiles - files.length;

			if (remaining <= 0) {
				const msg = `Maximum ${maxFiles} files allowed`;
				setError(msg);
				onError?.(msg);
				return;
			}

			const filesToAdd = fileArray.slice(0, remaining);
			const newFiles: FileAttachment[] = [];

			for (const file of filesToAdd) {
				const validationError = validateFile(file);
				if (validationError) {
					setError(validationError);
					onError?.(validationError);
					continue;
				}

				const fileType = getFileType(file);

				try {
					let preview: string | undefined;
					let data: string | undefined;
					let textContent: string | undefined;
					let mediaType = file.type || 'application/octet-stream';

					if (fileType === 'image') {
						if (supportsImages) {
							[preview, data] = await Promise.all([
								fileToPreview(file),
								fileToBase64(file),
							]);
						} else {
							preview = await fileToPreview(file);
						}
					} else if (fileType === 'pdf') {
						mediaType = 'application/pdf';
						if (supportsFileAttachments) {
							data = await fileToBase64(file);
						}
					} else if (fileType === 'text') {
						textContent = await fileToText(file);
						data = textContent;
						if (!file.type) {
							const ext = file.name.toLowerCase();
							mediaType =
								ext.endsWith('.md') || ext.endsWith('.markdown')
									? 'text/markdown'
									: 'text/plain';
						}
					}

					const id = generateId();
					newFiles.push({
						id,
						file,
						type: fileType,
						name: file.name,
						preview,
						data,
						mediaType,
						textContent,
						uploadStatus: 'uploading',
					});
				} catch {
					const msg = `Failed to process file: ${file.name}`;
					setError(msg);
					onError?.(msg);
				}
			}

			if (newFiles.length > 0) {
				setFiles((prev) => [...prev, ...newFiles]);
				for (const item of newFiles) {
					void uploadOriginalFile(item.file, sessionId)
						.then((uploadedAttachment) => {
							setFiles((prev) =>
								prev.map((existing) =>
									existing.id === item.id
										? {
												...existing,
												uploadStatus: 'ready',
												uploadedAttachment,
												uploadError: undefined,
											}
										: existing,
								),
							);
						})
						.catch((uploadError: unknown) => {
							const msg =
								uploadError instanceof Error
									? uploadError.message
									: `Failed to upload ${item.name}`;
							setFiles((prev) =>
								prev.map((existing) =>
									existing.id === item.id
										? {
												...existing,
												uploadStatus: 'failed',
												uploadError: msg,
											}
										: existing,
								),
							);
							onError?.(msg);
						});
				}
			}
		},
		[
			files.length,
			maxFiles,
			validateFile,
			onError,
			sessionId,
			supportsImages,
			supportsFileAttachments,
		],
	);

	const removeFile = useCallback((id: string) => {
		setFiles((prev) => prev.filter((f) => f.id !== id));
		setError(null);
	}, []);

	const clearFiles = useCallback(() => {
		setFiles([]);
		setError(null);
	}, []);

	const handleDragEnter = useCallback((e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer.types.includes('Files')) {
			setIsDragging(true);
		}
	}, []);

	const handleDragLeave = useCallback((e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = e.clientX;
		const y = e.clientY;
		if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
			setIsDragging(false);
		}
	}, []);

	const handleDragOver = useCallback((e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
	}, []);

	const handleDrop = useCallback(
		(e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragging(false);

			const droppedFiles = e.dataTransfer.files;
			if (droppedFiles.length > 0) {
				addFiles(Array.from(droppedFiles));
			}
		},
		[addFiles],
	);

	const handlePaste = useCallback(
		(e: ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) return;

			const pastedFiles: File[] = [];
			for (const item of Array.from(items)) {
				if (item.kind === 'file') {
					const file = item.getAsFile();
					if (file) {
						pastedFiles.push(file);
					}
				}
			}

			if (pastedFiles.length > 0) {
				e.preventDefault();
				addFiles(pastedFiles);
			}
		},
		[addFiles],
	);

	useEffect(() => {
		if (!pageWide) return;

		let dragCounter = 0;

		const onDragEnter = (e: globalThis.DragEvent) => {
			e.preventDefault();
			if (e.dataTransfer?.types.includes('Files')) {
				dragCounter++;
				if (dragCounter === 1) {
					setIsDragging(true);
				}
			}
		};

		const onDragLeave = (e: globalThis.DragEvent) => {
			e.preventDefault();
			dragCounter--;
			if (dragCounter === 0) {
				setIsDragging(false);
			}
		};

		const onDragOver = (e: globalThis.DragEvent) => {
			e.preventDefault();
		};

		const onDrop = (e: globalThis.DragEvent) => {
			e.preventDefault();
			dragCounter = 0;
			setIsDragging(false);

			const droppedFiles = e.dataTransfer?.files;
			if (droppedFiles && droppedFiles.length > 0) {
				addFiles(Array.from(droppedFiles));
			}
		};

		document.addEventListener('dragenter', onDragEnter);
		document.addEventListener('dragleave', onDragLeave);
		document.addEventListener('dragover', onDragOver);
		document.addEventListener('drop', onDrop);

		return () => {
			document.removeEventListener('dragenter', onDragEnter);
			document.removeEventListener('dragleave', onDragLeave);
			document.removeEventListener('dragover', onDragOver);
			document.removeEventListener('drop', onDrop);
		};
	}, [pageWide, addFiles]);

	const images = files.filter((f) => f.type === 'image');
	const documents = files.filter((f) => f.type !== 'image');

	return {
		files,
		images,
		documents,
		isDragging,
		error,
		addFiles,
		removeFile,
		clearFiles,
		handleDragEnter,
		handleDragLeave,
		handleDragOver,
		handleDrop,
		handlePaste,
	};
}
