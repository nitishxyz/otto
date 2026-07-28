export type ClassValue = string | false | null | undefined;

/** Join conditional class names. Later values win only by CSS order, not merge. */
export function cn(...parts: ClassValue[]): string {
	return parts.filter(Boolean).join(' ');
}
