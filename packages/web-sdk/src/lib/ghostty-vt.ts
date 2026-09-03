import type { GhosttyCell, IRenderable } from 'ghostty-web';
import ghosttyVtMetadata from '../assets/ghostty/ghostty-vt.json';

const ghosttyVtUrl = new URL(
	'../assets/ghostty/ghostty-vt.wasm',
	import.meta.url,
).href;

export const GHOSTTY_VT_SHA256 = ghosttyVtMetadata.sha256;

interface LayoutField {
	offset: number;
	size: number;
	type: string;
}
interface LayoutType {
	size: number;
	fields: Record<string, LayoutField>;
}
export type GhosttyTypeLayout = Record<string, LayoutType>;

type WasmFunction = (...args: number[]) => number;
interface GhosttyExports extends WebAssembly.Exports {
	memory: WebAssembly.Memory;
	ghostty_type_json: WasmFunction;
	ghostty_wasm_alloc_opaque: WasmFunction;
	ghostty_wasm_free_opaque: WasmFunction;
	ghostty_wasm_alloc_u8_array: WasmFunction;
	ghostty_wasm_free_u8_array: WasmFunction;
	ghostty_terminal_new: WasmFunction;
	ghostty_terminal_free: WasmFunction;
	ghostty_terminal_get: WasmFunction;
	ghostty_terminal_set: WasmFunction;
	ghostty_terminal_resize: WasmFunction;
	ghostty_terminal_vt_write: WasmFunction;
	ghostty_terminal_scroll_viewport: WasmFunction;
	ghostty_render_state_new: WasmFunction;
	ghostty_render_state_free: WasmFunction;
	ghostty_render_state_update: WasmFunction;
	ghostty_render_state_get: WasmFunction;
	ghostty_render_state_set: WasmFunction;
	ghostty_render_state_row_iterator_new: WasmFunction;
	ghostty_render_state_row_iterator_free: WasmFunction;
	ghostty_render_state_row_iterator_next: WasmFunction;
	ghostty_render_state_row_get: WasmFunction;
	ghostty_render_state_row_cells_new: WasmFunction;
	ghostty_render_state_row_cells_free: WasmFunction;
	ghostty_render_state_row_cells_next: WasmFunction;
	ghostty_render_state_row_cells_get: WasmFunction;
	ghostty_cell_get: (cell: bigint, data: number, out: number) => number;
}

export interface GhosttyVtModule {
	instance: WebAssembly.Instance;
	exports: GhosttyExports;
	layout: GhosttyTypeLayout;
}

let sharedModule: Promise<GhosttyVtModule> | undefined;

function readCString(memory: WebAssembly.Memory, pointer: number): string {
	const bytes = new Uint8Array(memory.buffer);
	let end = pointer;
	while (end < bytes.length && bytes[end] !== 0) end++;
	return new TextDecoder().decode(bytes.subarray(pointer, end));
}

export async function loadGhosttyVt(
	source: string | URL | ArrayBuffer = ghosttyVtUrl,
): Promise<GhosttyVtModule> {
	if (source === ghosttyVtUrl && sharedModule) return sharedModule;
	const load = async () => {
		const bytes =
			source instanceof ArrayBuffer
				? source
				: await (await fetch(source)).arrayBuffer();
		const result = await WebAssembly.instantiate(bytes, {});
		const exports = result.instance.exports as GhosttyExports;
		const required = [
			'ghostty_type_json',
			'ghostty_terminal_new',
			'ghostty_terminal_get',
			'ghostty_terminal_set',
			'ghostty_terminal_vt_write',
			'ghostty_terminal_scroll_viewport',
			'ghostty_render_state_update',
		];
		for (const name of required) {
			if (typeof exports[name] !== 'function') {
				throw new Error(`Official ghostty-vt module is missing ${name}`);
			}
		}
		const layout = JSON.parse(
			readCString(exports.memory, exports.ghostty_type_json()),
		) as GhosttyTypeLayout;
		if (!layout.GhosttyStyle || !layout.GhosttyRenderStateColors) {
			throw new Error(
				'Official ghostty-vt module returned an invalid type layout',
			);
		}
		return { instance: result.instance, exports, layout };
	};
	const promise = load();
	if (source === ghosttyVtUrl) sharedModule = promise;
	return promise;
}

const DEFAULT_FG = { r: 212, g: 212, b: 212 };
const DEFAULT_BG = { r: 18, g: 18, b: 22 };
const DEFAULT_SCROLLBACK_LINES = 50_000;

export interface GhosttyTerminalScrollbar {
	total: number;
	offset: number;
	len: number;
}

export class GhosttyVtTerminal implements IRenderable {
	readonly module: GhosttyVtModule;
	private readonly exports: GhosttyExports;
	private terminal: number;
	private renderState: number;
	private scratch: number;
	private readonly scratchLength = 512;
	private lines: GhosttyCell[][] = [];
	private graphemes: string[][] = [];
	private cursor: {
		x: number;
		y: number;
		visible: boolean;
		blinking: boolean;
		style: 'block' | 'underline' | 'bar' | 'blockHollow';
	} = {
		x: 0,
		y: 0,
		visible: true,
		blinking: true,
		style: 'block',
	};
	private dirty = 2;
	cols: number;
	rows: number;

	constructor(module: GhosttyVtModule, cols = 80, rows = 24) {
		this.module = module;
		this.exports = module.exports;
		this.cols = cols;
		this.rows = rows;
		this.terminal = this.createHandle((out) =>
			this.exports.ghostty_terminal_new(0, out, cols, rows),
		);
		this.renderState = this.createHandle((out) =>
			this.exports.ghostty_render_state_new(0, out),
		);
		this.scratch = this.exports.ghostty_wasm_alloc_u8_array(this.scratchLength);
		if (!this.scratch) throw new Error('ghostty-vt scratch allocation failed');
		this.setUsizeOption(28, DEFAULT_SCROLLBACK_LINES);
		this.refresh();
	}

	private view(): DataView {
		return new DataView(this.exports.memory.buffer);
	}
	private bytes(): Uint8Array {
		return new Uint8Array(
			this.exports.memory.buffer,
			this.scratch,
			this.scratchLength,
		);
	}
	private createHandle(create: (out: number) => number): number {
		const pointer = this.exports.ghostty_wasm_alloc_opaque();
		if (!pointer) throw new Error('ghostty-vt handle allocation failed');
		const result = create(pointer);
		const handle = this.view().getUint32(pointer, true);
		this.exports.ghostty_wasm_free_opaque(pointer);
		if (result !== 0 || !handle) {
			throw new Error(`ghostty-vt handle creation failed (${result})`);
		}
		return handle;
	}
	private getRenderU32(data: number): number {
		this.bytes().fill(0);
		if (
			this.exports.ghostty_render_state_get(
				this.renderState,
				data,
				this.scratch,
			) !== 0
		)
			return 0;
		return this.view().getUint32(this.scratch, true);
	}
	private getCellU32(cell: bigint, data: number): number {
		if (this.exports.ghostty_cell_get(cell, data, this.scratch + 256) !== 0)
			return 0;
		return this.view().getUint32(this.scratch + 256, true);
	}
	private setUsizeOption(option: number, value: number): void {
		this.view().setUint32(this.scratch, value, true);
		const result = this.exports.ghostty_terminal_set(
			this.terminal,
			option,
			this.scratch,
		);
		if (result !== 0) {
			throw new Error(
				`ghostty-vt terminal option ${option} failed (${result})`,
			);
		}
	}
	private resolvedColor(
		cells: number,
		data: number,
		fallback: { r: number; g: number; b: number },
	) {
		const pointer = this.scratch + 320;
		if (
			this.exports.ghostty_render_state_row_cells_get(cells, data, pointer) !==
			0
		)
			return fallback;
		const bytes = new Uint8Array(this.exports.memory.buffer, pointer, 3);
		return {
			r: bytes[0] ?? fallback.r,
			g: bytes[1] ?? fallback.g,
			b: bytes[2] ?? fallback.b,
		};
	}
	private styleFlags(cells: number): number {
		const layout = this.module.layout.GhosttyStyle;
		const pointer = this.scratch + 352;
		new Uint8Array(this.exports.memory.buffer, pointer, layout.size).fill(0);
		this.view().setUint32(
			pointer + layout.fields.size.offset,
			layout.size,
			true,
		);
		if (
			this.exports.ghostty_render_state_row_cells_get(cells, 2, pointer) !== 0
		)
			return 0;
		const value = (field: string) => {
			const metadata = layout.fields[field];
			return metadata
				? this.view().getUint8(pointer + metadata.offset) !== 0
				: false;
		};
		let flags = 0;
		if (value('bold')) flags |= 1;
		if (value('italic')) flags |= 2;
		const underline = layout.fields.underline;
		if (
			underline &&
			this.view().getInt32(pointer + underline.offset, true) !== 0
		)
			flags |= 4;
		if (value('strikethrough')) flags |= 8;
		if (value('inverse')) flags |= 16;
		if (value('invisible')) flags |= 32;
		if (value('blink')) flags |= 64;
		if (value('faint')) flags |= 128;
		return flags;
	}

	write(data: string | Uint8Array): void {
		const bytes =
			typeof data === 'string' ? new TextEncoder().encode(data) : data;
		if (bytes.length === 0) return;
		const pointer = this.exports.ghostty_wasm_alloc_u8_array(bytes.length);
		if (!pointer) throw new Error('ghostty-vt input allocation failed');
		new Uint8Array(this.exports.memory.buffer, pointer, bytes.length).set(
			bytes,
		);
		this.exports.ghostty_terminal_vt_write(
			this.terminal,
			pointer,
			bytes.length,
		);
		this.exports.ghostty_wasm_free_u8_array(pointer, bytes.length);
		this.refresh();
	}

	resize(cols: number, rows: number, cellWidth = 0, cellHeight = 0): void {
		if (cols === this.cols && rows === this.rows) return;
		const result = this.exports.ghostty_terminal_resize(
			this.terminal,
			cols,
			rows,
			Math.max(0, Math.round(cellWidth)),
			Math.max(0, Math.round(cellHeight)),
		);
		if (result !== 0) throw new Error(`ghostty-vt resize failed (${result})`);
		this.cols = cols;
		this.rows = rows;
		this.refresh();
	}

	private scrollViewport(tag: number, value: number): void {
		const layout = this.module.layout.GhosttyTerminalScrollViewport;
		if (!layout) throw new Error('ghostty-vt scroll layout is unavailable');
		const pointer = this.exports.ghostty_wasm_alloc_u8_array(layout.size);
		if (!pointer) throw new Error('ghostty-vt scroll allocation failed');
		try {
			new Uint8Array(this.exports.memory.buffer, pointer, layout.size).fill(0);
			this.view().setUint32(pointer + layout.fields.tag.offset, tag, true);
			if (tag === 2) {
				this.view().setInt32(
					pointer + layout.fields.value.offset,
					Math.trunc(value),
					true,
				);
			} else {
				this.view().setUint32(
					pointer + layout.fields.value.offset,
					Math.max(0, Math.trunc(value)),
					true,
				);
			}
			this.exports.ghostty_terminal_scroll_viewport(this.terminal, pointer);
		} finally {
			this.exports.ghostty_wasm_free_u8_array(pointer, layout.size);
		}
		this.refresh();
	}

	scroll(delta: number): void {
		this.scrollViewport(2, delta);
	}

	scrollToRow(row: number): void {
		this.scrollViewport(3, row);
	}

	getScrollbar(): GhosttyTerminalScrollbar {
		const layout = this.module.layout.GhosttyTerminalScrollbar;
		if (!layout) throw new Error('ghostty-vt scrollbar layout is unavailable');
		new Uint8Array(this.exports.memory.buffer, this.scratch, layout.size).fill(
			0,
		);
		const result = this.exports.ghostty_terminal_get(
			this.terminal,
			9,
			this.scratch,
		);
		if (result !== 0) {
			throw new Error(`ghostty-vt scrollbar query failed (${result})`);
		}
		const read = (field: string) =>
			Number(
				this.view().getBigUint64(
					this.scratch + layout.fields[field].offset,
					true,
				),
			);
		return {
			total: read('total'),
			offset: read('offset'),
			len: read('len'),
		};
	}

	isViewportAtBottom(): boolean {
		const scrollbar = this.getScrollbar();
		return scrollbar.offset + scrollbar.len >= scrollbar.total;
	}

	refresh(): void {
		if (
			this.exports.ghostty_render_state_update(
				this.renderState,
				this.terminal,
			) !== 0
		)
			return;
		this.cols = this.getRenderU32(1) || this.cols;
		this.rows = this.getRenderU32(2) || this.rows;
		this.dirty = this.getRenderU32(3);
		// Data indices match GhosttyRenderStateData in ghostty/vt/render.h:
		// 10 visual style, 11 visible, 12 blinking, 14 in-viewport, 15/16 x/y.
		const styleRaw = this.getRenderU32(10);
		const style =
			styleRaw === 0
				? 'bar'
				: styleRaw === 2
					? 'underline'
					: styleRaw === 3
						? 'blockHollow'
						: 'block';
		this.cursor = {
			x: this.getRenderU32(15),
			y: this.getRenderU32(16),
			visible: Boolean(this.getRenderU32(11) && this.getRenderU32(14)),
			blinking: Boolean(this.getRenderU32(12)),
			style,
		};
		const iteratorPointer = this.exports.ghostty_wasm_alloc_opaque();
		const cellsPointer = this.exports.ghostty_wasm_alloc_opaque();
		if (!iteratorPointer || !cellsPointer) return;
		this.exports.ghostty_render_state_row_iterator_new(0, iteratorPointer);
		this.exports.ghostty_render_state_row_cells_new(0, cellsPointer);
		this.exports.ghostty_render_state_get(this.renderState, 4, iteratorPointer);
		const iterator = this.view().getUint32(iteratorPointer, true);
		const cells = this.view().getUint32(cellsPointer, true);
		const lines: GhosttyCell[][] = [];
		const graphemes: string[][] = [];
		while (this.exports.ghostty_render_state_row_iterator_next(iterator)) {
			this.exports.ghostty_render_state_row_get(iterator, 3, cellsPointer);
			const line: GhosttyCell[] = [];
			const lineGraphemes: string[] = [];
			while (this.exports.ghostty_render_state_row_cells_next(cells)) {
				this.exports.ghostty_render_state_row_cells_get(cells, 1, this.scratch);
				const raw = this.view().getBigUint64(this.scratch, true);
				const codepoint = this.getCellU32(raw, 1);
				const wide = this.getCellU32(raw, 3);
				const lengthPointer = this.scratch + 288;
				this.exports.ghostty_render_state_row_cells_get(
					cells,
					3,
					lengthPointer,
				);
				const graphemeLength = this.view().getUint32(lengthPointer, true);
				let text = codepoint ? String.fromCodePoint(codepoint) : '';
				if (graphemeLength > 1 && graphemeLength <= 32) {
					const pointer = this.scratch + 64;
					this.exports.ghostty_render_state_row_cells_get(cells, 4, pointer);
					const points = new Uint32Array(
						this.exports.memory.buffer,
						pointer,
						graphemeLength,
					);
					text = String.fromCodePoint(...points);
				}
				const fg = this.resolvedColor(cells, 6, DEFAULT_FG);
				const bg = this.resolvedColor(cells, 5, DEFAULT_BG);
				line.push({
					codepoint,
					fg_r: fg.r,
					fg_g: fg.g,
					fg_b: fg.b,
					bg_r: bg.r,
					bg_g: bg.g,
					bg_b: bg.b,
					flags: this.styleFlags(cells),
					width: wide === 1 ? 2 : wide === 2 ? 0 : 1,
					hyperlink_id: 0,
					grapheme_len: graphemeLength,
				});
				lineGraphemes.push(text);
			}
			lines.push(line);
			graphemes.push(lineGraphemes);
		}
		this.exports.ghostty_render_state_row_cells_free(cells);
		this.exports.ghostty_render_state_row_iterator_free(iterator);
		this.exports.ghostty_wasm_free_opaque(cellsPointer);
		this.exports.ghostty_wasm_free_opaque(iteratorPointer);
		this.lines = lines;
		this.graphemes = graphemes;
	}

	getLine(y: number): GhosttyCell[] | null {
		return this.lines[y] ?? null;
	}
	getCursor() {
		return this.cursor;
	}
	getDimensions() {
		return { cols: this.cols, rows: this.rows };
	}
	isRowDirty(): boolean {
		return this.dirty !== 0;
	}
	needsFullRedraw(): boolean {
		return this.dirty === 2;
	}
	clearDirty(): void {
		this.bytes()[0] = 0;
		this.exports.ghostty_render_state_set(this.renderState, 0, this.scratch);
		this.dirty = 0;
	}
	getGraphemeString(row: number, col: number): string {
		return this.graphemes[row]?.[col] ?? '';
	}
	lineText(row: number): string {
		return (this.graphemes[row] ?? []).join('').replace(/\s+$/, '');
	}

	free(): void {
		this.exports.ghostty_wasm_free_u8_array(this.scratch, this.scratchLength);
		this.exports.ghostty_render_state_free(this.renderState);
		this.exports.ghostty_terminal_free(this.terminal);
		this.scratch = 0;
		this.renderState = 0;
		this.terminal = 0;
	}
}
