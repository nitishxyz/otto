import {
	cloneElement,
	isValidElement,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import type { CSSProperties, ReactElement, ReactNode, Ref } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipTargetRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

interface TooltipProps {
	content: ReactNode;
	side?: TooltipSide;
	/** Delay in ms before the tooltip appears. Defaults to instant. */
	delay?: number;
	children: ReactElement;
}

const GAP = 8;
const VIEWPORT_MARGIN = 8;
const ARROW_INSET = 12;

interface Anchor {
	x: number;
	y: number;
}

function getAnchor(rect: TooltipTargetRect, side: TooltipSide): Anchor {
	switch (side) {
		case 'top':
			return { x: rect.left + rect.width / 2, y: rect.top - GAP };
		case 'bottom':
			return { x: rect.left + rect.width / 2, y: rect.bottom + GAP };
		case 'left':
			return { x: rect.left - GAP, y: rect.top + rect.height / 2 };
		case 'right':
			return { x: rect.right + GAP, y: rect.top + rect.height / 2 };
	}
}

const enterOffset: Record<TooltipSide, { x?: number; y?: number }> = {
	top: { y: 4 },
	bottom: { y: -4 },
	left: { x: 4 },
	right: { x: -4 },
};

const arrowBorderClasses: Record<TooltipSide, string> = {
	top: 'top-full -mt-px border-x-transparent border-b-transparent border-t-border',
	bottom:
		'bottom-full -mb-px border-x-transparent border-t-transparent border-b-border',
	left: 'left-full -ml-px border-y-transparent border-r-transparent border-l-border',
	right:
		'right-full -mr-px border-y-transparent border-l-transparent border-r-border',
};

const arrowFillClasses: Record<TooltipSide, string> = {
	top: 'top-full -mt-[2px] border-x-transparent border-b-transparent border-t-popover',
	bottom:
		'bottom-full -mb-[2px] border-x-transparent border-t-transparent border-b-popover',
	left: 'left-full -ml-[2px] border-y-transparent border-r-transparent border-l-popover',
	right:
		'right-full -mr-[2px] border-y-transparent border-l-transparent border-r-popover',
};

interface TooltipBubbleProps {
	anchor: Anchor;
	side: TooltipSide;
	content: ReactNode;
	className?: string;
	style?: CSSProperties;
}

function TooltipBubble({
	anchor,
	side,
	content,
	className,
	style,
}: TooltipBubbleProps) {
	const bubbleRef = useRef<HTMLDivElement | null>(null);
	const [layout, setLayout] = useState<{
		left: number;
		top: number;
		arrow: number;
	} | null>(null);

	useLayoutEffect(() => {
		const el = bubbleRef.current;
		if (!el) return;
		const { offsetWidth: w, offsetHeight: h } = el;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		if (side === 'top' || side === 'bottom') {
			const left = Math.min(
				Math.max(anchor.x - w / 2, VIEWPORT_MARGIN),
				Math.max(vw - w - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
			);
			const top = side === 'top' ? anchor.y - h : anchor.y;
			const arrow = Math.min(
				Math.max(anchor.x - left, ARROW_INSET),
				w - ARROW_INSET,
			);
			setLayout({ left, top, arrow });
			return;
		}

		const top = Math.min(
			Math.max(anchor.y - h / 2, VIEWPORT_MARGIN),
			Math.max(vh - h - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
		);
		const left = side === 'left' ? anchor.x - w : anchor.x;
		const arrow = Math.min(
			Math.max(anchor.y - top, ARROW_INSET),
			h - ARROW_INSET,
		);
		setLayout({ left, top, arrow });
	}, [anchor, side]);

	const horizontal = side === 'top' || side === 'bottom';
	const arrowStyle: CSSProperties = layout
		? horizontal
			? { left: layout.arrow, transform: 'translateX(-50%)' }
			: { top: layout.arrow, transform: 'translateY(-50%)' }
		: {};

	return (
		<div
			className="pointer-events-none fixed z-[9999]"
			style={{
				left: layout?.left ?? anchor.x,
				top: layout?.top ?? anchor.y,
				visibility: layout ? 'visible' : 'hidden',
			}}
		>
			<motion.div
				ref={bubbleRef}
				initial={{ opacity: 0, scale: 0.95, ...enterOffset[side] }}
				animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
				exit={{ opacity: 0, scale: 0.95, ...enterOffset[side] }}
				transition={{ duration: 0.12, ease: 'easeOut' }}
				className={`relative rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md ${
					className ?? 'whitespace-nowrap'
				}`}
				style={{ fontSize: 12, lineHeight: '16px', ...style }}
				role="tooltip"
			>
				{content}
				<span
					aria-hidden="true"
					className={`absolute h-0 w-0 border-[5px] ${arrowBorderClasses[side]}`}
					style={arrowStyle}
				/>
				<span
					aria-hidden="true"
					className={`absolute h-0 w-0 border-[5px] ${arrowFillClasses[side]}`}
					style={arrowStyle}
				/>
			</motion.div>
		</div>
	);
}

interface TooltipPopupProps {
	content: ReactNode;
	target: TooltipTargetRect | null;
	side?: TooltipSide;
	className?: string;
	style?: CSSProperties;
}

/**
 * Controlled tooltip popup for virtual or pointer-driven targets. This is
 * useful when the active target is calculated by a parent rather than being
 * represented by one stable trigger element.
 */
export function TooltipPopup({
	content,
	target,
	side = 'top',
	className,
	style,
}: TooltipPopupProps) {
	if (typeof document === 'undefined') return null;

	return createPortal(
		<AnimatePresence>
			{target && (
				<TooltipBubble
					anchor={getAnchor(target, side)}
					side={side}
					content={content}
					className={className}
					style={style}
				/>
			)}
		</AnimatePresence>,
		document.body,
	);
}

/**
 * Lightweight animated tooltip. Renders via portal so it is never clipped
 * by overflow or transformed ancestors, and clamps to the viewport while
 * the arrow keeps pointing at the trigger. Wraps a single child element
 * and shows on hover/focus.
 */
export function Tooltip({
	content,
	side = 'top',
	delay = 0,
	children,
}: TooltipProps) {
	const [target, setTarget] = useState<TooltipTargetRect | null>(null);
	const timeoutRef = useRef<number | null>(null);
	const triggerRef = useRef<HTMLElement | null>(null);

	const show = useCallback(() => {
		if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
		const open = () => {
			const el = triggerRef.current;
			if (!el) return;
			setTarget(el.getBoundingClientRect());
		};
		if (delay <= 0) {
			open();
			return;
		}
		timeoutRef.current = window.setTimeout(open, delay);
	}, [delay]);

	const hide = useCallback(() => {
		if (timeoutRef.current) {
			window.clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
		setTarget(null);
	}, []);

	if (!isValidElement(children)) return children;

	const childProps = children.props as Record<string, unknown>;
	const trigger = cloneElement(children, {
		ref: (node: HTMLElement | null) => {
			triggerRef.current = node;
			const childRef = (children as { ref?: Ref<HTMLElement> }).ref;
			if (typeof childRef === 'function') childRef(node);
			else if (childRef && 'current' in childRef) {
				(childRef as { current: HTMLElement | null }).current = node;
			}
		},
		onMouseEnter: (event: MouseEvent) => {
			(childProps.onMouseEnter as ((e: MouseEvent) => void) | undefined)?.(
				event,
			);
			show();
		},
		onMouseLeave: (event: MouseEvent) => {
			(childProps.onMouseLeave as ((e: MouseEvent) => void) | undefined)?.(
				event,
			);
			hide();
		},
		onFocus: (event: FocusEvent) => {
			(childProps.onFocus as ((e: FocusEvent) => void) | undefined)?.(event);
			show();
		},
		onBlur: (event: FocusEvent) => {
			(childProps.onBlur as ((e: FocusEvent) => void) | undefined)?.(event);
			hide();
		},
		onClick: (event: MouseEvent) => {
			(childProps.onClick as ((e: MouseEvent) => void) | undefined)?.(event);
			hide();
		},
	} as Partial<unknown>);

	return (
		<>
			{trigger}
			<TooltipPopup target={target} side={side} content={content} />
		</>
	);
}
