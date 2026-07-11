import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { acquireAuthenticatedAsset } from '../lib/authenticated-asset';

export interface AuthenticatedImageProps
	extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
	src: string;
	onResolvedSrc?: (src: string) => void;
}

/** Renders protected daemon images using current owner/share auth headers. */
export function AuthenticatedImage({
	src,
	onResolvedSrc,
	alt = '',
	...props
}: AuthenticatedImageProps) {
	const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const resolvedCallback = useRef(onResolvedSrc);
	resolvedCallback.current = onResolvedSrc;

	useEffect(() => {
		let active = true;
		let release = () => {};
		setResolvedSrc(null);
		setFailed(false);
		void acquireAuthenticatedAsset(src)
			.then((asset) => {
				release = asset.release;
				if (!active) {
					release();
					return;
				}
				setResolvedSrc(asset.url);
				resolvedCallback.current?.(asset.url);
			})
			.catch(() => {
				if (active) setFailed(true);
			});
		return () => {
			active = false;
			release();
		};
	}, [src]);

	if (failed) {
		return (
			<span
				role="img"
				aria-label={`${alt || 'Attachment'} failed to load`}
				className={props.className}
			/>
		);
	}
	if (!resolvedSrc) {
		return (
			<output
				aria-label={`${alt || 'Attachment'} loading`}
				className={props.className}
			/>
		);
	}
	return <img {...props} src={resolvedSrc} alt={alt} />;
}
