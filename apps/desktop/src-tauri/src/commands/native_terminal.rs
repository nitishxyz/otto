mod gpu;

use gpu::{
    GpuTerminalBounds, GpuTerminalCursorOverride, GpuTerminalFont, GpuTerminalManager,
    GpuTerminalStatus,
};
use libghostty_vt::{
    key::{Action as KeyAction, Encoder as KeyEncoder, Event as KeyEvent, Key, Mods},
    render::{CellIterator, CursorVisualStyle, RenderState, RowIterator},
    screen::CellWide,
    style::{PaletteIndex, RgbColor, Underline},
    terminal::ScrollViewport,
    Terminal, TerminalOptions,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{mpsc, Arc, Mutex},
    thread,
};

const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const MAX_SCROLLBACK: usize = 50_000;
const TERMINAL_BACKGROUND: RgbColor = RgbColor {
    r: 18,
    g: 18,
    b: 22,
};
const TERMINAL_FOREGROUND: RgbColor = RgbColor {
    r: 212,
    g: 212,
    b: 212,
};
const TERMINAL_SELECTION_BACKGROUND: RgbColor = RgbColor {
    r: 38,
    g: 79,
    b: 120,
};
const TERMINAL_SELECTION_FOREGROUND: RgbColor = RgbColor {
    r: 255,
    g: 255,
    b: 255,
};
const TERMINAL_CURSOR: RgbColor = RgbColor {
    r: 255,
    g: 255,
    b: 255,
};
const OTTO_ANSI_PALETTE: [RgbColor; 16] = [
    RgbColor { r: 0, g: 0, b: 0 },
    RgbColor {
        r: 205,
        g: 49,
        b: 49,
    },
    RgbColor {
        r: 13,
        g: 188,
        b: 121,
    },
    RgbColor {
        r: 229,
        g: 229,
        b: 16,
    },
    RgbColor {
        r: 36,
        g: 114,
        b: 200,
    },
    RgbColor {
        r: 188,
        g: 63,
        b: 188,
    },
    RgbColor {
        r: 17,
        g: 168,
        b: 205,
    },
    RgbColor {
        r: 229,
        g: 229,
        b: 229,
    },
    RgbColor {
        r: 102,
        g: 102,
        b: 102,
    },
    RgbColor {
        r: 241,
        g: 76,
        b: 76,
    },
    RgbColor {
        r: 35,
        g: 209,
        b: 139,
    },
    RgbColor {
        r: 245,
        g: 245,
        b: 67,
    },
    RgbColor {
        r: 59,
        g: 142,
        b: 234,
    },
    RgbColor {
        r: 214,
        g: 112,
        b: 214,
    },
    RgbColor {
        r: 41,
        g: 184,
        b: 219,
    },
    RgbColor {
        r: 229,
        g: 229,
        b: 229,
    },
];

#[derive(Clone)]
pub struct NativeTerminalManager {
    sender: mpsc::Sender<WorkerRequest>,
    gpu: GpuTerminalManager,
}

impl NativeTerminalManager {
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        thread::Builder::new()
            .name("otto-native-terminal".into())
            .spawn(move || run_worker(receiver))
            .expect("failed to start native terminal worker");
        Self {
            sender,
            gpu: GpuTerminalManager::default(),
        }
    }

    fn request<T>(
        &self,
        build: impl FnOnce(mpsc::Sender<Result<T, String>>) -> WorkerRequest,
    ) -> Result<T, String> {
        let (sender, receiver) = mpsc::channel();
        self.sender
            .send(build(sender))
            .map_err(|_| "Native terminal worker is unavailable".to_string())?;
        receiver
            .recv()
            .map_err(|_| "Native terminal worker stopped unexpectedly".to_string())?
    }
}

impl Default for NativeTerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

enum WorkerRequest {
    Create {
        session_id: String,
        cols: u16,
        rows: u16,
        theme: Option<NativeTerminalTheme>,
        reply: mpsc::Sender<Result<NativeTerminalUpdate, String>>,
    },
    SetTheme {
        session_id: String,
        theme: NativeTerminalTheme,
        reply: mpsc::Sender<Result<NativeTerminalUpdate, String>>,
    },
    Feed {
        session_id: String,
        data: Vec<u8>,
        reply: mpsc::Sender<Result<NativeTerminalUpdate, String>>,
    },
    Resize {
        session_id: String,
        cols: u16,
        rows: u16,
        reply: mpsc::Sender<Result<NativeTerminalUpdate, String>>,
    },
    Key {
        session_id: String,
        event: NativeTerminalKeyEvent,
        reply: mpsc::Sender<Result<Vec<u8>, String>>,
    },
    Scroll {
        session_id: String,
        delta: isize,
        reply: mpsc::Sender<Result<NativeTerminalUpdate, String>>,
    },
    Select {
        session_id: String,
        selection: Option<NativeTerminalSelection>,
        reply: mpsc::Sender<Result<NativeTerminalUpdate, String>>,
    },
    Reset {
        session_id: String,
        reply: mpsc::Sender<Result<NativeTerminalUpdate, String>>,
    },
    Destroy {
        session_id: String,
        reply: mpsc::Sender<Result<(), String>>,
    },
}

struct NativeTerminalSession {
    terminal: Terminal<'static, 'static>,
    render_state: RenderState<'static>,
    row_iterator: RowIterator<'static>,
    cell_iterator: CellIterator<'static>,
    key_encoder: KeyEncoder<'static>,
    key_event: KeyEvent<'static>,
    pty_writes: Arc<Mutex<Vec<Vec<u8>>>>,
    theme: ResolvedNativeTerminalTheme,
    selection: Option<NativeTerminalSelection>,
}

#[derive(Clone, Copy)]
struct ResolvedNativeTerminalTheme {
    background: RgbColor,
    foreground: RgbColor,
    cursor: RgbColor,
    selection_background: RgbColor,
    selection_foreground: RgbColor,
    palette: [RgbColor; 16],
}

fn configure_terminal_theme(
    terminal: &mut Terminal<'_, '_>,
    theme: Option<&NativeTerminalTheme>,
) -> Result<ResolvedNativeTerminalTheme, String> {
    let resolved = ResolvedNativeTerminalTheme {
        background: theme
            .map(|theme| theme.background.into())
            .unwrap_or(TERMINAL_BACKGROUND),
        foreground: theme
            .map(|theme| theme.foreground.into())
            .unwrap_or(TERMINAL_FOREGROUND),
        cursor: theme
            .map(|theme| theme.cursor.into())
            .unwrap_or(TERMINAL_CURSOR),
        selection_background: theme
            .map(|theme| theme.selection_background.into())
            .unwrap_or(TERMINAL_SELECTION_BACKGROUND),
        selection_foreground: theme
            .map(|theme| theme.selection_foreground.into())
            .unwrap_or(TERMINAL_SELECTION_FOREGROUND),
        palette: theme
            .map(|theme| theme.palette.map(Into::into))
            .unwrap_or(OTTO_ANSI_PALETTE),
    };
    terminal
        .set_default_fg_color(Some(resolved.foreground))
        .map_err(native_error)?
        .set_default_bg_color(Some(resolved.background))
        .map_err(native_error)?
        .set_default_cursor_color(Some(resolved.cursor))
        .map_err(native_error)?;
    let mut palette = terminal.default_color_palette().map_err(native_error)?;
    for (index, color) in resolved.palette.into_iter().enumerate() {
        palette.set(PaletteIndex(index as u8), color);
    }
    terminal
        .set_default_color_palette(Some(palette))
        .map_err(native_error)?;
    Ok(resolved)
}

impl NativeTerminalSession {
    fn new(cols: u16, rows: u16, theme: Option<NativeTerminalTheme>) -> Result<Self, String> {
        let pty_writes = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let mut terminal = Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: MAX_SCROLLBACK,
        })
        .map_err(native_error)?;
        let theme = configure_terminal_theme(&mut terminal, theme.as_ref())?;
        let callback_writes = Arc::clone(&pty_writes);
        terminal
            .on_pty_write(move |_terminal, data| {
                if let Ok(mut writes) = callback_writes.lock() {
                    writes.push(data.to_vec());
                }
            })
            .map_err(native_error)?;

        Ok(Self {
            terminal,
            render_state: RenderState::new().map_err(native_error)?,
            row_iterator: RowIterator::new().map_err(native_error)?,
            cell_iterator: CellIterator::new().map_err(native_error)?,
            key_encoder: KeyEncoder::new().map_err(native_error)?,
            key_event: KeyEvent::new().map_err(native_error)?,
            pty_writes,
            theme,
            selection: None,
        })
    }

    fn set_theme(&mut self, theme: NativeTerminalTheme) -> Result<NativeTerminalUpdate, String> {
        self.theme = configure_terminal_theme(&mut self.terminal, Some(&theme))?;
        self.update()
    }

    fn feed(&mut self, data: &[u8]) -> Result<NativeTerminalUpdate, String> {
        self.terminal.vt_write(data);
        self.update()
    }

    fn resize(&mut self, cols: u16, rows: u16) -> Result<NativeTerminalUpdate, String> {
        self.terminal
            .resize(cols, rows, 0, 0)
            .map_err(native_error)?;
        self.update()
    }

    fn update(&mut self) -> Result<NativeTerminalUpdate, String> {
        let snapshot = self.snapshot()?;
        let selected_text = self.selected_text(&snapshot);
        let pty_writes = self
            .pty_writes
            .lock()
            .map_err(|_| "Native terminal response buffer is unavailable".to_string())?
            .drain(..)
            .flatten()
            .collect();
        Ok(NativeTerminalUpdate {
            snapshot,
            pty_writes,
            selected_text,
        })
    }

    fn snapshot(&mut self) -> Result<NativeTerminalSnapshot, String> {
        let snapshot = self
            .render_state
            .update(&self.terminal)
            .map_err(native_error)?;
        let cols = snapshot.cols().map_err(native_error)?;
        let rows = snapshot.rows().map_err(native_error)?;
        let colors = snapshot.colors().map_err(native_error)?;
        let cursor_position = snapshot.cursor_viewport().map_err(native_error)?;
        let cursor = NativeTerminalCursor {
            col: cursor_position.map_or(0, |position| position.x),
            row: cursor_position.map_or(0, |position| position.y),
            visible: snapshot.cursor_visible().map_err(native_error)?,
            blinking: snapshot.cursor_blinking().map_err(native_error)?,
            shape: cursor_shape(snapshot.cursor_visual_style().map_err(native_error)?),
            color: snapshot
                .cursor_color()
                .map_err(native_error)?
                .or(colors.cursor)
                .map(Into::into),
        };

        let mut rows_data = Vec::with_capacity(rows as usize);
        let mut row_iteration = self.row_iterator.update(&snapshot).map_err(native_error)?;
        while let Some(row) = row_iteration.next() {
            let row_index = rows_data.len() as u16;
            let mut cells = Vec::with_capacity(cols as usize);
            let mut cell_iteration = self.cell_iterator.update(row).map_err(native_error)?;
            while let Some(cell) = cell_iteration.next() {
                let col_index = cells.len() as u16;
                let style = cell.style().map_err(native_error)?;
                let raw_cell = cell.raw_cell().map_err(native_error)?;
                let text = if style.invisible {
                    String::new()
                } else {
                    cell.graphemes()
                        .map_err(native_error)?
                        .into_iter()
                        .collect()
                };
                cells.push(NativeTerminalCell {
                    text,
                    fg: cell.fg_color().map_err(native_error)?.map(Into::into),
                    bg: cell.bg_color().map_err(native_error)?.map(Into::into),
                    bold: style.bold,
                    italic: style.italic,
                    faint: style.faint,
                    inverse: style.inverse,
                    strikethrough: style.strikethrough,
                    underline: style.underline != Underline::None,
                    wide: raw_cell.wide().map_err(native_error)? == CellWide::Wide,
                    spacer: matches!(
                        raw_cell.wide().map_err(native_error)?,
                        CellWide::SpacerTail | CellWide::SpacerHead
                    ),
                    selected: self.selection.is_some_and(|selection| {
                        selection.contains(col_index, row_index, cols, rows)
                    }),
                });
            }
            while cells.len() < cols as usize {
                cells.push(NativeTerminalCell::default());
            }
            rows_data.push(NativeTerminalRow { cells });
        }
        while rows_data.len() < rows as usize {
            rows_data.push(NativeTerminalRow {
                cells: vec![NativeTerminalCell::default(); cols as usize],
            });
        }

        Ok(NativeTerminalSnapshot {
            cols,
            rows,
            rows_data,
            default_fg: colors.foreground.into(),
            default_bg: colors.background.into(),
            selection_bg: self.theme.selection_background.into(),
            selection_fg: self.theme.selection_foreground.into(),
            cursor,
        })
    }

    fn encode_key(&mut self, input: NativeTerminalKeyEvent) -> Result<Vec<u8>, String> {
        let Some(key) = dom_code_to_key(&input.code) else {
            return Ok(input.text.unwrap_or_default().into_bytes());
        };
        let mut mods = Mods::empty();
        if input.shift {
            mods |= Mods::SHIFT;
        }
        if input.alt {
            mods |= Mods::ALT;
        }
        if input.ctrl {
            mods |= Mods::CTRL;
        }
        if input.meta {
            mods |= Mods::SUPER;
        }
        self.key_event
            .set_action(if input.repeat {
                KeyAction::Repeat
            } else {
                KeyAction::Press
            })
            .set_key(key)
            .set_mods(mods)
            .set_consumed_mods(Mods::empty())
            .set_utf8(input.text);
        self.key_encoder.set_options_from_terminal(&self.terminal);
        let mut output = Vec::with_capacity(16);
        self.key_encoder
            .encode_to_vec(&self.key_event, &mut output)
            .map_err(native_error)?;
        Ok(output)
    }

    fn scroll(&mut self, delta: isize) -> Result<NativeTerminalUpdate, String> {
        self.selection = None;
        self.terminal.scroll_viewport(ScrollViewport::Delta(delta));
        self.update()
    }

    fn select(
        &mut self,
        selection: Option<NativeTerminalSelection>,
    ) -> Result<NativeTerminalUpdate, String> {
        self.selection = selection;
        self.update()
    }

    fn selected_text(&self, snapshot: &NativeTerminalSnapshot) -> Option<String> {
        self.selection?;
        let mut selected_rows = Vec::new();
        for row in &snapshot.rows_data {
            let mut text = String::new();
            let mut has_selection = false;
            for cell in &row.cells {
                if !cell.selected {
                    continue;
                }
                has_selection = true;
                if !cell.spacer {
                    if cell.text.is_empty() {
                        text.push(' ');
                    } else {
                        text.push_str(&cell.text);
                    }
                }
            }
            if has_selection {
                selected_rows.push(text.trim_end_matches(' ').to_string());
            }
        }
        Some(selected_rows.join("\n"))
    }

    fn reset(&mut self) -> Result<NativeTerminalUpdate, String> {
        self.terminal.reset();
        self.update()
    }
}

fn run_worker(receiver: mpsc::Receiver<WorkerRequest>) {
    let mut sessions = HashMap::<String, NativeTerminalSession>::new();
    while let Ok(request) = receiver.recv() {
        match request {
            WorkerRequest::Create {
                session_id,
                cols,
                rows,
                theme,
                reply,
            } => {
                let result = (|| {
                    let session = match sessions.entry(session_id) {
                        std::collections::hash_map::Entry::Occupied(entry) => {
                            let session = entry.into_mut();
                            session.terminal.reset();
                            session.theme =
                                configure_terminal_theme(&mut session.terminal, theme.as_ref())?;
                            session.selection = None;
                            session
                                .terminal
                                .resize(cols.max(1), rows.max(1), 0, 0)
                                .map_err(native_error)?;
                            session
                        }
                        std::collections::hash_map::Entry::Vacant(entry) => entry
                            .insert(NativeTerminalSession::new(cols.max(1), rows.max(1), theme)?),
                    };
                    session.update()
                })();
                let _ = reply.send(result);
            }
            WorkerRequest::SetTheme {
                session_id,
                theme,
                reply,
            } => {
                let result = session_mut(&mut sessions, &session_id)
                    .and_then(|session| session.set_theme(theme));
                let _ = reply.send(result);
            }
            WorkerRequest::Feed {
                session_id,
                data,
                reply,
            } => {
                let result =
                    session_mut(&mut sessions, &session_id).and_then(|session| session.feed(&data));
                let _ = reply.send(result);
            }
            WorkerRequest::Resize {
                session_id,
                cols,
                rows,
                reply,
            } => {
                let result = session_mut(&mut sessions, &session_id)
                    .and_then(|session| session.resize(cols.max(1), rows.max(1)));
                let _ = reply.send(result);
            }
            WorkerRequest::Select {
                session_id,
                selection,
                reply,
            } => {
                let result = session_mut(&mut sessions, &session_id)
                    .and_then(|session| session.select(selection));
                let _ = reply.send(result);
            }
            WorkerRequest::Scroll {
                session_id,
                delta,
                reply,
            } => {
                let result = session_mut(&mut sessions, &session_id)
                    .and_then(|session| session.scroll(delta));
                let _ = reply.send(result);
            }
            WorkerRequest::Reset { session_id, reply } => {
                let result =
                    session_mut(&mut sessions, &session_id).and_then(NativeTerminalSession::reset);
                let _ = reply.send(result);
            }
            WorkerRequest::Key {
                session_id,
                event,
                reply,
            } => {
                let result = session_mut(&mut sessions, &session_id)
                    .and_then(|session| session.encode_key(event));
                let _ = reply.send(result);
            }
            WorkerRequest::Destroy { session_id, reply } => {
                sessions.remove(&session_id);
                let _ = reply.send(Ok(()));
            }
        }
    }
}

fn session_mut<'a>(
    sessions: &'a mut HashMap<String, NativeTerminalSession>,
    session_id: &str,
) -> Result<&'a mut NativeTerminalSession, String> {
    sessions
        .get_mut(session_id)
        .ok_or_else(|| format!("Native terminal session {session_id} was not found"))
}

fn native_error(error: impl std::fmt::Display) -> String {
    format!("libghostty-vt: {error}")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalStatus {
    available: bool,
    backend: &'static str,
    renderer: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalUpdate {
    snapshot: NativeTerminalSnapshot,
    pty_writes: Vec<u8>,
    selected_text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalRenderResult {
    pty_writes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalSnapshot {
    cols: u16,
    rows: u16,
    rows_data: Vec<NativeTerminalRow>,
    default_fg: NativeTerminalRgb,
    default_bg: NativeTerminalRgb,
    selection_bg: NativeTerminalRgb,
    selection_fg: NativeTerminalRgb,
    cursor: NativeTerminalCursor,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct NativeTerminalRow {
    cells: Vec<NativeTerminalCell>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
struct NativeTerminalCell {
    text: String,
    fg: Option<NativeTerminalRgb>,
    bg: Option<NativeTerminalRgb>,
    bold: bool,
    italic: bool,
    faint: bool,
    inverse: bool,
    strikethrough: bool,
    underline: bool,
    wide: bool,
    spacer: bool,
    selected: bool,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Serialize)]
struct NativeTerminalRgb {
    r: u8,
    g: u8,
    b: u8,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalTheme {
    background: NativeTerminalRgb,
    foreground: NativeTerminalRgb,
    cursor: NativeTerminalRgb,
    selection_background: NativeTerminalRgb,
    selection_foreground: NativeTerminalRgb,
    palette: [NativeTerminalRgb; 16],
}

impl From<NativeTerminalRgb> for RgbColor {
    fn from(value: NativeTerminalRgb) -> Self {
        Self {
            r: value.r,
            g: value.g,
            b: value.b,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalPoint {
    col: u16,
    row: u16,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalSelection {
    start: NativeTerminalPoint,
    end: NativeTerminalPoint,
}

impl NativeTerminalSelection {
    fn contains(self, col: u16, row: u16, cols: u16, rows: u16) -> bool {
        if cols == 0 || rows == 0 {
            return false;
        }
        let clamp = |point: NativeTerminalPoint| {
            let row = point.row.min(rows - 1) as usize;
            let col = point.col.min(cols - 1) as usize;
            row * cols as usize + col
        };
        let start = clamp(self.start);
        let end = clamp(self.end);
        let current = row as usize * cols as usize + col as usize;
        current >= start.min(end) && current <= start.max(end)
    }
}

impl From<RgbColor> for NativeTerminalRgb {
    fn from(value: RgbColor) -> Self {
        Self {
            r: value.r,
            g: value.g,
            b: value.b,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTerminalCursor {
    col: u16,
    row: u16,
    visible: bool,
    blinking: bool,
    shape: &'static str,
    color: Option<NativeTerminalRgb>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalKeyEvent {
    code: String,
    text: Option<String>,
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
    repeat: bool,
}

fn cursor_shape(style: CursorVisualStyle) -> &'static str {
    match style {
        CursorVisualStyle::Bar => "bar",
        CursorVisualStyle::Underline => "underline",
        CursorVisualStyle::BlockHollow => "blockHollow",
        _ => "block",
    }
}

fn dom_code_to_key(code: &str) -> Option<Key> {
    Some(match code {
        "Backquote" => Key::Backquote,
        "Backslash" => Key::Backslash,
        "BracketLeft" => Key::BracketLeft,
        "BracketRight" => Key::BracketRight,
        "Comma" => Key::Comma,
        "Equal" => Key::Equal,
        "Minus" => Key::Minus,
        "Period" => Key::Period,
        "Quote" => Key::Quote,
        "Semicolon" => Key::Semicolon,
        "Slash" => Key::Slash,
        "Space" => Key::Space,
        "Tab" => Key::Tab,
        "Enter" => Key::Enter,
        "NumpadEnter" => Key::NumpadEnter,
        "Backspace" => Key::Backspace,
        "Delete" => Key::Delete,
        "Insert" => Key::Insert,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "ArrowUp" => Key::ArrowUp,
        "ArrowDown" => Key::ArrowDown,
        "ArrowLeft" => Key::ArrowLeft,
        "ArrowRight" => Key::ArrowRight,
        "Escape" => Key::Escape,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        value if value.len() == 4 && value.starts_with("Key") => match &value[3..] {
            "A" => Key::A,
            "B" => Key::B,
            "C" => Key::C,
            "D" => Key::D,
            "E" => Key::E,
            "F" => Key::F,
            "G" => Key::G,
            "H" => Key::H,
            "I" => Key::I,
            "J" => Key::J,
            "K" => Key::K,
            "L" => Key::L,
            "M" => Key::M,
            "N" => Key::N,
            "O" => Key::O,
            "P" => Key::P,
            "Q" => Key::Q,
            "R" => Key::R,
            "S" => Key::S,
            "T" => Key::T,
            "U" => Key::U,
            "V" => Key::V,
            "W" => Key::W,
            "X" => Key::X,
            "Y" => Key::Y,
            "Z" => Key::Z,
            _ => return None,
        },
        value if value.len() == 6 && value.starts_with("Digit") => match &value[5..] {
            "0" => Key::Digit0,
            "1" => Key::Digit1,
            "2" => Key::Digit2,
            "3" => Key::Digit3,
            "4" => Key::Digit4,
            "5" => Key::Digit5,
            "6" => Key::Digit6,
            "7" => Key::Digit7,
            "8" => Key::Digit8,
            "9" => Key::Digit9,
            _ => return None,
        },
        _ => return None,
    })
}

#[tauri::command]
pub fn native_terminal_status() -> NativeTerminalStatus {
    NativeTerminalStatus {
        available: true,
        backend: "libghostty-vt",
        renderer: "canvas2d",
    }
}

#[tauri::command]
pub fn native_terminal_create(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    theme: Option<NativeTerminalTheme>,
) -> Result<NativeTerminalUpdate, String> {
    let render_id = session_id.clone();
    let update = manager.request(|reply| WorkerRequest::Create {
        session_id,
        cols: cols.unwrap_or(DEFAULT_COLS),
        rows: rows.unwrap_or(DEFAULT_ROWS),
        theme,
        reply,
    })?;
    manager.gpu.render(&render_id, &update.snapshot);
    Ok(update)
}

#[tauri::command]
pub fn native_terminal_set_theme(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    theme: NativeTerminalTheme,
) -> Result<NativeTerminalUpdate, String> {
    let render_id = session_id.clone();
    let update = manager.request(|reply| WorkerRequest::SetTheme {
        session_id,
        theme,
        reply,
    })?;
    manager.gpu.render(&render_id, &update.snapshot);
    Ok(update)
}

#[tauri::command]
pub fn native_terminal_feed(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<NativeTerminalUpdate, String> {
    let render_id = session_id.clone();
    let update = manager.request(|reply| WorkerRequest::Feed {
        session_id,
        data,
        reply,
    })?;
    manager.gpu.render(&render_id, &update.snapshot);
    Ok(update)
}

#[tauri::command]
pub fn native_terminal_feed_gpu(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<NativeTerminalRenderResult, String> {
    let render_id = session_id.clone();
    let update = manager.request(|reply| WorkerRequest::Feed {
        session_id,
        data,
        reply,
    })?;
    manager.gpu.render(&render_id, &update.snapshot);
    Ok(NativeTerminalRenderResult {
        pty_writes: update.pty_writes,
    })
}

#[tauri::command]
pub fn native_terminal_resize(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<NativeTerminalUpdate, String> {
    let render_id = session_id.clone();
    let update = manager.request(|reply| WorkerRequest::Resize {
        session_id,
        cols,
        rows,
        reply,
    })?;
    manager.gpu.render(&render_id, &update.snapshot);
    Ok(update)
}

#[tauri::command]
pub fn native_terminal_key(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    event: NativeTerminalKeyEvent,
) -> Result<Vec<u8>, String> {
    manager.request(|reply| WorkerRequest::Key {
        session_id,
        event,
        reply,
    })
}

#[tauri::command]
pub fn native_terminal_scroll(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    delta: isize,
) -> Result<NativeTerminalUpdate, String> {
    let render_id = session_id.clone();
    let update = manager.request(|reply| WorkerRequest::Scroll {
        session_id,
        delta,
        reply,
    })?;
    manager.gpu.render(&render_id, &update.snapshot);
    Ok(update)
}

#[tauri::command]
pub fn native_terminal_scroll_gpu(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    delta: isize,
) -> Result<(), String> {
    let render_id = session_id.clone();
    let update = manager.request(|reply| WorkerRequest::Scroll {
        session_id,
        delta,
        reply,
    })?;
    manager.gpu.render(&render_id, &update.snapshot);
    Ok(())
}

#[tauri::command]
pub fn native_terminal_select(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    selection: Option<NativeTerminalSelection>,
) -> Result<NativeTerminalUpdate, String> {
    let render_id = session_id.clone();
    let update = manager.request(|reply| WorkerRequest::Select {
        session_id,
        selection,
        reply,
    })?;
    manager.gpu.render(&render_id, &update.snapshot);
    Ok(update)
}

#[tauri::command]
pub fn native_terminal_reset(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
) -> Result<NativeTerminalUpdate, String> {
    let render_id = session_id.clone();
    let update = manager.request(|reply| WorkerRequest::Reset { session_id, reply })?;
    manager.gpu.render(&render_id, &update.snapshot);
    Ok(update)
}

#[tauri::command]
pub fn native_terminal_destroy(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
) -> Result<(), String> {
    manager.gpu.forget(&session_id);
    manager.request(|reply| WorkerRequest::Destroy { session_id, reply })
}

#[tauri::command]
pub async fn native_terminal_surface_create(
    app_handle: tauri::AppHandle<tauri::Wry>,
    window: tauri::Window<tauri::Wry>,
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    bounds: GpuTerminalBounds,
    font: Option<GpuTerminalFont>,
) -> Result<GpuTerminalStatus, String> {
    manager
        .gpu
        .create(
            &app_handle,
            &window,
            &session_id,
            bounds,
            font.unwrap_or_default(),
        )
        .await
}

#[tauri::command]
pub fn native_terminal_surface_update(
    window: tauri::Window<tauri::Wry>,
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    bounds: GpuTerminalBounds,
) -> Result<(), String> {
    manager.gpu.update_bounds(&window, &session_id, bounds)
}

#[tauri::command]
pub fn native_terminal_surface_set_font(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    font: GpuTerminalFont,
) -> Result<(), String> {
    manager.gpu.set_font(&session_id, font)
}

#[tauri::command]
pub fn native_terminal_surface_cursor(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
    cursor: GpuTerminalCursorOverride,
) -> Result<(), String> {
    manager.gpu.set_cursor(&session_id, cursor)
}

#[tauri::command]
pub fn native_terminal_surface_destroy(
    manager: tauri::State<'_, NativeTerminalManager>,
    session_id: String,
) {
    manager.gpu.destroy(&session_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_terminal_output_and_resizes() {
        let mut session = NativeTerminalSession::new(10, 2, None).unwrap();
        let update = session.feed(b"\x1b[31mR\x1b[0m").unwrap();
        let cell = &update.snapshot.rows_data[0].cells[0];
        assert_eq!(cell.text, "R");
        assert_eq!(
            cell.fg.map(|color| (color.r, color.g, color.b)),
            Some((205, 49, 49))
        );

        let resized = session.resize(20, 4).unwrap();
        assert_eq!(resized.snapshot.cols, 20);
        assert_eq!(resized.snapshot.rows, 4);
    }

    #[test]
    fn encodes_keys_using_terminal_modes() {
        let mut session = NativeTerminalSession::new(10, 2, None).unwrap();
        let output = session
            .encode_key(NativeTerminalKeyEvent {
                code: "KeyC".into(),
                text: Some("c".into()),
                ctrl: true,
                alt: false,
                shift: false,
                meta: false,
                repeat: false,
            })
            .unwrap();
        assert_eq!(output, vec![3]);
    }

    #[test]
    fn returns_terminal_generated_pty_responses() {
        let mut session = NativeTerminalSession::new(10, 2, None).unwrap();
        let update = session.feed(b"\x1b[5n").unwrap();
        assert_eq!(update.pty_writes, b"\x1b[0n");
    }

    #[test]
    fn applies_the_application_terminal_theme() {
        let palette = OTTO_ANSI_PALETTE.map(Into::into);
        let mut session = NativeTerminalSession::new(
            10,
            2,
            Some(NativeTerminalTheme {
                background: NativeTerminalRgb {
                    r: 240,
                    g: 241,
                    b: 242,
                },
                foreground: NativeTerminalRgb {
                    r: 32,
                    g: 33,
                    b: 34,
                },
                cursor: NativeTerminalRgb {
                    r: 35,
                    g: 36,
                    b: 37,
                },
                selection_background: NativeTerminalRgb {
                    r: 100,
                    g: 110,
                    b: 120,
                },
                selection_foreground: NativeTerminalRgb {
                    r: 250,
                    g: 251,
                    b: 252,
                },
                palette,
            }),
        )
        .unwrap();
        let snapshot = session.snapshot().unwrap();
        assert_eq!(
            (
                snapshot.default_bg.r,
                snapshot.default_bg.g,
                snapshot.default_bg.b
            ),
            (240, 241, 242)
        );
        assert_eq!(
            (
                snapshot.default_fg.r,
                snapshot.default_fg.g,
                snapshot.default_fg.b
            ),
            (32, 33, 34)
        );
        assert_eq!(
            (
                snapshot.selection_bg.r,
                snapshot.selection_bg.g,
                snapshot.selection_bg.b
            ),
            (100, 110, 120)
        );
    }

    #[test]
    fn selects_and_extracts_visible_terminal_text() {
        let mut session = NativeTerminalSession::new(10, 2, None).unwrap();
        session.feed(b"hello world").unwrap();
        let update = session
            .select(Some(NativeTerminalSelection {
                start: NativeTerminalPoint { col: 1, row: 0 },
                end: NativeTerminalPoint { col: 4, row: 0 },
            }))
            .unwrap();
        assert_eq!(update.selected_text.as_deref(), Some("ello"));
        assert!(update.snapshot.rows_data[0].cells[1].selected);
        assert!(!update.snapshot.rows_data[0].cells[0].selected);
    }

    #[test]
    fn recreate_resets_existing_parser_history() {
        let manager = NativeTerminalManager::new();
        manager
            .request(|reply| WorkerRequest::Create {
                session_id: "same".into(),
                cols: 10,
                rows: 2,
                theme: None,
                reply,
            })
            .unwrap();
        manager
            .request(|reply| WorkerRequest::Feed {
                session_id: "same".into(),
                data: b"old".to_vec(),
                reply,
            })
            .unwrap();
        let recreated = manager
            .request(|reply| WorkerRequest::Create {
                session_id: "same".into(),
                cols: 10,
                rows: 2,
                theme: None,
                reply,
            })
            .unwrap();
        let text = recreated.snapshot.rows_data[0]
            .cells
            .iter()
            .map(|cell| cell.text.as_str())
            .collect::<String>();
        assert!(!text.contains("old"));
    }
}
