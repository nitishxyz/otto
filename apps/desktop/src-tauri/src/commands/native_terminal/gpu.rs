use super::{NativeTerminalCell, NativeTerminalRgb, NativeTerminalSnapshot};
use bytemuck::{Pod, Zeroable};
use glyphon::{
    Attrs, Buffer, Cache, Color as GlyphColor, Family, FontSystem, Metrics, Resolution, Shaping,
    Style as FontStyle, SwashCache, TextArea, TextAtlas, TextBounds, TextRenderer, Viewport,
    Weight,
};
use std::{collections::HashMap, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Window, WindowBuilder, Wry};
use wgpu::{util::DeviceExt, SurfaceTarget};

const DEFAULT_FONT_FAMILY: &str = "JetBrainsMono NF";
const DEFAULT_FONT_SIZE: f32 = 13.0;
const DEFAULT_CELL_WIDTH: f32 = 8.0;
const DEFAULT_CELL_HEIGHT: f32 = 17.0;
const RECT_SHADER: &str = r#"
struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) color: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(input.position, 0.0, 1.0);
    output.color = input.color;
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return input.color;
}
"#;

#[derive(Clone, Default)]
pub struct GpuTerminalManager {
    surfaces: std::sync::Arc<Mutex<HashMap<String, GpuTerminalSurface>>>,
    snapshots: std::sync::Arc<Mutex<HashMap<String, NativeTerminalSnapshot>>>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuTerminalStatus {
    pub available: bool,
    pub backend: String,
    pub message: String,
    /// Effective logical cell width measured from the font the GPU renderer
    /// actually resolved. The JS canvas measurement can disagree with it,
    /// which skews cursor/rect positions against shaped text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_width: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_height: Option<f32>,
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuTerminalBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub hidden: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuTerminalFont {
    pub family: Option<String>,
    pub size: Option<f32>,
    pub cell_width: Option<f32>,
    pub cell_height: Option<f32>,
}

impl Default for GpuTerminalFont {
    fn default() -> Self {
        Self {
            family: None,
            size: Some(DEFAULT_FONT_SIZE),
            cell_width: Some(DEFAULT_CELL_WIDTH),
            cell_height: Some(DEFAULT_CELL_HEIGHT),
        }
    }
}

impl GpuTerminalManager {
    pub async fn create(
        &self,
        app: &AppHandle<Wry>,
        owner: &Window<Wry>,
        session_id: &str,
        bounds: GpuTerminalBounds,
        font: GpuTerminalFont,
    ) -> Result<GpuTerminalStatus, String> {
        let manager = self.clone();
        let main_app = app.clone();
        let owner_window = owner.clone();
        let owner_label = owner.label().to_string();
        let owned_session_id = session_id.to_string();
        let (prepared_tx, prepared_rx) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            manager.destroy(&owned_session_id);
            let result = (|| {
                let label = overlay_label(&owner_label, &owned_session_id);
                let overlay = WindowBuilder::new(&main_app, &label)
                    .title("otto terminal")
                    .inner_size(bounds.width.max(1.0), bounds.height.max(1.0))
                    .position(-10_000.0, -10_000.0)
                    .decorations(false)
                    .shadow(false)
                    .resizable(false)
                    .focusable(false)
                    .focused(false)
                    .skip_taskbar(true)
                    .visible(false)
                    .parent(&owner_window)
                    .map_err(|error| error.to_string())?
                    .build()
                    .map_err(|error| error.to_string())?;
                overlay
                    .set_ignore_cursor_events(true)
                    .map_err(|error| error.to_string())?;
                configure_overlay_window(&overlay)?;
                PendingGpuTerminalSurface::new(&main_app, overlay, font)
            })();
            let _ = prepared_tx.send(result);
        })
        .map_err(|error| error.to_string())?;
        let prepared = prepared_rx
            .await
            .map_err(|_| "GPU terminal surface preparation was cancelled".to_string())??;
        let renderer = prepared.finish(app).await?;
        self.surfaces
            .lock()
            .map_err(|_| "GPU terminal surface registry is unavailable".to_string())?
            .insert(session_id.to_string(), renderer);
        let manager = self.clone();
        let owner = owner.clone();
        let session_id = session_id.to_string();
        let bounds_session_id = session_id.clone();
        let (bounds_tx, bounds_rx) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let _ = bounds_tx.send(manager.update_bounds(&owner, &bounds_session_id, bounds));
        })
        .map_err(|error| error.to_string())?;
        bounds_rx
            .await
            .map_err(|_| "GPU terminal surface positioning was cancelled".to_string())??;

        let mut presented = false;
        for _ in 0..4 {
            if self.render_latest(&session_id) {
                presented = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(16)).await;
        }
        if !presented {
            self.destroy(&session_id);
            return Ok(GpuTerminalStatus {
                available: false,
                backend: "canvas".into(),
                message: "Native GPU terminal did not present its initial frame.".into(),
                cell_width: None,
                cell_height: None,
            });
        }

        let cell_metrics = self.surfaces.lock().ok().and_then(|surfaces| {
            surfaces.get(&session_id).map(|surface| {
                (
                    surface.font.cell_width / surface.scale_factor,
                    surface.font.cell_height / surface.scale_factor,
                )
            })
        });

        Ok(GpuTerminalStatus {
            available: true,
            backend: "wgpu".into(),
            message: "Native GPU terminal uses Metal, Vulkan/GLES, or DirectX 12.".into(),
            cell_width: cell_metrics.map(|(width, _)| width),
            cell_height: cell_metrics.map(|(_, height)| height),
        })
    }

    pub fn update_bounds(
        &self,
        owner: &Window<Wry>,
        session_id: &str,
        bounds: GpuTerminalBounds,
    ) -> Result<(), String> {
        let mut surfaces = self
            .surfaces
            .lock()
            .map_err(|_| "GPU terminal surface registry is unavailable".to_string())?;
        let surface = surfaces
            .get_mut(session_id)
            .ok_or_else(|| format!("GPU terminal surface {session_id} was not found"))?;
        if bounds.hidden || bounds.width < 1.0 || bounds.height < 1.0 {
            surface.window.hide().map_err(|error| error.to_string())?;
            return Ok(());
        }

        let scale = owner.scale_factor().map_err(|error| error.to_string())?;
        let origin = owner.inner_position().map_err(|error| error.to_string())?;
        let position = PhysicalPosition::new(
            origin.x + (bounds.x * scale).round() as i32,
            origin.y + (bounds.y * scale).round() as i32,
        );
        let size = PhysicalSize::new(
            (bounds.width * scale).round().max(1.0) as u32,
            (bounds.height * scale).round().max(1.0) as u32,
        );
        surface
            .window
            .set_position(position)
            .map_err(|error| error.to_string())?;
        surface
            .window
            .set_size(size)
            .map_err(|error| error.to_string())?;
        surface.resize(size.width, size.height, scale as f32);
        // tao's show() runs makeKeyAndOrderFront on macOS, which activates the
        // overlay's window and steals focus from whichever window the user is
        // in. Bounds syncs fire on any DOM mutation (terminal output updates
        // badges/timestamps), so that stole focus continuously. Order the
        // overlay above its owner without focusing instead.
        #[cfg(target_os = "macos")]
        show_overlay_without_focus(owner, &surface.window);
        #[cfg(not(target_os = "macos"))]
        surface.window.show().map_err(|error| error.to_string())?;

        // The overlay is a rectangular child window; clip whichever of its
        // corners coincide with the owner window's rounded corners so the
        // terminal never pokes outside the window silhouette.
        #[cfg(target_os = "macos")]
        {
            ensure_overlay_child_window(owner, &surface.window);
            let inner = owner.inner_size().map_err(|error| error.to_string())?;
            let owner_width = inner.width as f64 / scale;
            let owner_height = inner.height as f64 / scale;
            const EDGE_EPSILON: f64 = 2.0;
            let left = bounds.x <= EDGE_EPSILON;
            let right = bounds.x + bounds.width >= owner_width - EDGE_EPSILON;
            let top = bounds.y <= EDGE_EPSILON;
            let bottom = bounds.y + bounds.height >= owner_height - EDGE_EPSILON;
            // CALayer coordinates are bottom-up: MinY corners are the bottom edge.
            let mut mask: usize = 0;
            if left && bottom {
                mask |= 1 << 0; // kCALayerMinXMinYCorner
            }
            if right && bottom {
                mask |= 1 << 1; // kCALayerMaxXMinYCorner
            }
            if left && top {
                mask |= 1 << 2; // kCALayerMinXMaxYCorner
            }
            if right && top {
                mask |= 1 << 3; // kCALayerMaxXMaxYCorner
            }
            if surface.corner_mask != Some(mask) {
                surface.corner_mask = Some(mask);
                apply_overlay_corner_mask(&surface.window, mask, macos_window_corner_radius());
            }
        }
        Ok(())
    }

    pub fn render(&self, session_id: &str, snapshot: &NativeTerminalSnapshot) {
        if let Ok(mut snapshots) = self.snapshots.lock() {
            snapshots.insert(session_id.to_string(), snapshot.clone());
        }
        let _ = self.render_snapshot(session_id, snapshot);
    }

    fn render_latest(&self, session_id: &str) -> bool {
        let snapshot = self
            .snapshots
            .lock()
            .ok()
            .and_then(|snapshots| snapshots.get(session_id).cloned());
        snapshot
            .as_ref()
            .is_some_and(|snapshot| self.render_snapshot(session_id, snapshot))
    }

    fn render_snapshot(&self, session_id: &str, snapshot: &NativeTerminalSnapshot) -> bool {
        let Ok(mut surfaces) = self.surfaces.lock() else {
            return false;
        };
        let Some(surface) = surfaces.get_mut(session_id) else {
            return false;
        };
        surface.render(snapshot).unwrap_or(false)
    }

    pub fn set_font(&self, session_id: &str, font: GpuTerminalFont) -> Result<(), String> {
        let mut surfaces = self
            .surfaces
            .lock()
            .map_err(|_| "GPU terminal surface registry is unavailable".to_string())?;
        let surface = surfaces
            .get_mut(session_id)
            .ok_or_else(|| format!("GPU terminal surface {session_id} was not found"))?;
        surface.font = ResolvedFont::from(font, surface.scale_factor);
        surface.prepared_rows.clear();
        surface.prepared_cursor = None;
        surface.prepared_colors = None;
        Ok(())
    }

    pub fn destroy(&self, session_id: &str) {
        let surface = self
            .surfaces
            .lock()
            .ok()
            .and_then(|mut surfaces| surfaces.remove(session_id));
        if let Some(surface) = surface {
            let _ = surface.window.hide();
            let _ = surface.window.close();
        }
    }

    pub fn forget(&self, session_id: &str) {
        self.destroy(session_id);
        if let Ok(mut snapshots) = self.snapshots.lock() {
            snapshots.remove(session_id);
        }
    }
}

#[cfg(target_os = "macos")]
fn configure_overlay_window(window: &Window<Wry>) -> Result<(), String> {
    use objc2_app_kit::{NSColor, NSWindow, NSWindowAnimationBehavior, NSWindowCollectionBehavior};

    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    // SAFETY: Tauri returns the live NSWindow for this overlay. Creation and
    // configuration both run on AppKit's main thread.
    let window = unsafe { &*pointer.cast::<NSWindow>() };
    // No Transient: transient windows float to the active Space, which made
    // the overlay follow the user onto another fullscreen window's Space. As a
    // child window it already tracks its parent's Space; FullScreenAuxiliary
    // only permits it on the parent's fullscreen Space.
    let behavior = window.collectionBehavior()
        | NSWindowCollectionBehavior::IgnoresCycle
        | NSWindowCollectionBehavior::FullScreenAuxiliary;
    window.setCollectionBehavior(behavior);
    window.setAnimationBehavior(NSWindowAnimationBehavior::None);
    window.setExcludedFromWindowsMenu(true);
    window.setMovable(false);
    // Corner-masked regions must show the owner window beneath, not an
    // opaque window background.
    window.setOpaque(false);
    window.setBackgroundColor(Some(&NSColor::clearColor()));
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn configure_overlay_window(_window: &Window<Wry>) -> Result<(), String> {
    Ok(())
}

/// Shows the overlay by ordering it above its owner without making it key,
/// so appearing/re-appearing never activates the window or steals focus.
#[cfg(target_os = "macos")]
fn show_overlay_without_focus(owner: &Window<Wry>, overlay: &Window<Wry>) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let owner = owner.clone();
    let overlay_window = overlay.clone();
    let _ = overlay.run_on_main_thread(move || {
        let (Ok(owner_ptr), Ok(overlay_ptr)) = (owner.ns_window(), overlay_window.ns_window())
        else {
            return;
        };
        // SAFETY: live NSWindow pointers on AppKit's main thread.
        // orderWindow:relativeTo: shows without key/main or app activation.
        unsafe {
            let owner_window = owner_ptr.cast::<AnyObject>();
            let overlay_window = overlay_ptr.cast::<AnyObject>();
            let visible: bool = msg_send![overlay_window, isVisible];
            if visible {
                return;
            }
            let owner_number: isize = msg_send![owner_window, windowNumber];
            // NSWindowAbove = 1
            let _: () = msg_send![overlay_window, orderWindow: 1isize, relativeTo: owner_number];
        }
    });
}

/// Re-attaches the overlay as a child of its owner window. macOS silently
/// removes a child window from its parent when the child is ordered out
/// (`hide()`), so a later `show()` leaves it detached: it stops following the
/// owner during drags (snapping only on the next JS bounds sync) and floats
/// over other windows and Spaces.
#[cfg(target_os = "macos")]
fn ensure_overlay_child_window(owner: &Window<Wry>, overlay: &Window<Wry>) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let owner = owner.clone();
    let overlay_window = overlay.clone();
    let _ = overlay.run_on_main_thread(move || {
        let (Ok(owner_ptr), Ok(overlay_ptr)) = (owner.ns_window(), overlay_window.ns_window())
        else {
            return;
        };
        // SAFETY: both pointers are live NSWindow instances owned by Tauri and
        // this closure runs on AppKit's main thread. parentWindow /
        // addChildWindow:ordered: are standard AppKit selectors.
        unsafe {
            let owner_window = owner_ptr.cast::<AnyObject>();
            let overlay_window = overlay_ptr.cast::<AnyObject>();
            let parent: *mut AnyObject = msg_send![overlay_window, parentWindow];
            if std::ptr::eq(parent, owner_window) {
                return;
            }
            if !parent.is_null() {
                let _: () = msg_send![parent, removeChildWindow: overlay_window];
            }
            // NSWindowAbove = 1
            let _: () = msg_send![owner_window, addChildWindow: overlay_window, ordered: 1isize];
        }
    });
}

#[cfg(target_os = "macos")]
fn macos_window_corner_radius() -> f64 {
    use objc2_foundation::NSProcessInfo;
    let version = NSProcessInfo::processInfo().operatingSystemVersion();
    // macOS 26 (Tahoe) uses substantially larger window corner radii than
    // Big Sur through Sequoia (~10pt). Slight over-clipping is invisible
    // because the owner webview beneath shares the terminal background.
    if version.majorVersion >= 26 {
        26.0
    } else {
        12.0
    }
}

/// Applies a rounded-corner mask to the overlay's layer (the CAMetalLayer
/// wgpu attached to the content view) so GPU output respects the owner
/// window's silhouette. Runs on AppKit's main thread.
#[cfg(target_os = "macos")]
fn apply_overlay_corner_mask(overlay: &Window<Wry>, mask: usize, radius: f64) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let window = overlay.clone();
    let _ = overlay.run_on_main_thread(move || {
        let Ok(pointer) = window.ns_window() else {
            return;
        };
        // SAFETY: Tauri returns the live NSWindow for this overlay and the
        // closure runs on AppKit's main thread. contentView and layer are
        // standard AppKit/CoreAnimation selectors.
        unsafe {
            let ns_window = pointer.cast::<AnyObject>();
            let content_view: *mut AnyObject = msg_send![ns_window, contentView];
            if content_view.is_null() {
                return;
            }
            let layer: *mut AnyObject = msg_send![content_view, layer];
            if layer.is_null() {
                return;
            }
            let _: () = msg_send![layer, setMasksToBounds: true];
            let _: () = msg_send![layer, setCornerRadius: radius];
            let _: () = msg_send![layer, setMaskedCorners: mask];
        }
    });
}

struct GpuTerminalSurface {
    instance: wgpu::Instance,
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    font_system: FontSystem,
    swash_cache: SwashCache,
    viewport: Viewport,
    atlas: TextAtlas,
    text_renderer: TextRenderer,
    row_buffers: Vec<Buffer>,
    prepared_rows: Vec<super::NativeTerminalRow>,
    prepared_cursor: Option<(u16, u16, bool, &'static str)>,
    prepared_colors: Option<(NativeTerminalRgb, NativeTerminalRgb, NativeTerminalRgb)>,
    rect_pipeline: wgpu::RenderPipeline,
    font: ResolvedFont,
    scale_factor: f32,
    window: Window<Wry>,
    #[cfg(target_os = "macos")]
    corner_mask: Option<usize>,
}

struct PendingGpuTerminalSurface {
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    size: PhysicalSize<u32>,
    scale_factor: f32,
    font: GpuTerminalFont,
    window: Window<Wry>,
}

#[derive(Clone)]
struct ResolvedFont {
    family: String,
    size: f32,
    cell_width: f32,
    cell_height: f32,
}

impl ResolvedFont {
    fn from(font: GpuTerminalFont, scale_factor: f32) -> Self {
        let family = font
            .family
            .filter(|family| !family.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_FONT_FAMILY.to_string());
        Self {
            family,
            size: font.size.unwrap_or(DEFAULT_FONT_SIZE).max(8.0) * scale_factor,
            cell_width: font.cell_width.unwrap_or(DEFAULT_CELL_WIDTH).max(4.0) * scale_factor,
            cell_height: font.cell_height.unwrap_or(DEFAULT_CELL_HEIGHT).max(8.0) * scale_factor,
        }
    }
}

impl PendingGpuTerminalSurface {
    fn new(
        app: &AppHandle<Wry>,
        window: Window<Wry>,
        font: GpuTerminalFont,
    ) -> Result<Self, String> {
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let scale_factor = window.scale_factor().map_err(|error| error.to_string())? as f32;
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_with_display_handle(
            Box::new(app.clone()),
        ));
        let surface = instance
            .create_surface(SurfaceTarget::Window(Box::new(window.clone())))
            .map_err(|error| format!("Failed to create terminal GPU surface: {error}"))?;
        Ok(Self {
            instance,
            surface,
            size,
            scale_factor,
            font,
            window,
        })
    }

    async fn finish(self, app: &AppHandle<Wry>) -> Result<GpuTerminalSurface, String> {
        let adapter = self
            .instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&self.surface),
                force_fallback_adapter: false,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("No terminal GPU adapter is available: {error}"))?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("otto terminal device"),
                ..Default::default()
            })
            .await
            .map_err(|error| format!("Failed to create terminal GPU device: {error}"))?;
        let capabilities = self.surface.get_capabilities(&adapter);
        let format = capabilities
            .formats
            .iter()
            .copied()
            .find(wgpu::TextureFormat::is_srgb)
            .or_else(|| capabilities.formats.first().copied())
            .ok_or_else(|| "Terminal GPU surface has no supported format".to_string())?;
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: self.size.width.max(1),
            height: self.size.height.max(1),
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode: capabilities
                .alpha_modes
                .first()
                .copied()
                .unwrap_or(wgpu::CompositeAlphaMode::Opaque),
            view_formats: Vec::new(),
            desired_maximum_frame_latency: 2,
            color_space: wgpu::SurfaceColorSpace::Auto,
        };
        self.surface.configure(&device, &config);

        let mut font_system = FontSystem::new();
        load_embedded_fonts(app, &mut font_system);
        let mut resolved_font = ResolvedFont::from(self.font, self.scale_factor);
        if let Some(advance) = measure_cell_advance(
            &mut font_system,
            &resolved_font.family,
            resolved_font.size,
            resolved_font.cell_height,
        ) {
            if advance.is_finite() && advance >= 1.0 {
                resolved_font.cell_width = advance;
            }
        }
        let swash_cache = SwashCache::new();
        let cache = Cache::new(&device);
        let viewport = Viewport::new(&device, &cache);
        let mut atlas = TextAtlas::new(&device, &queue, &cache, format);
        let text_renderer =
            TextRenderer::new(&mut atlas, &device, wgpu::MultisampleState::default(), None);
        let rect_pipeline = create_rect_pipeline(&device, format);

        Ok(GpuTerminalSurface {
            instance: self.instance,
            device,
            queue,
            surface: self.surface,
            config,
            font_system,
            swash_cache,
            viewport,
            atlas,
            text_renderer,
            row_buffers: Vec::new(),
            prepared_rows: Vec::new(),
            prepared_cursor: None,
            prepared_colors: None,
            rect_pipeline,
            font: resolved_font,
            scale_factor: self.scale_factor,
            window: self.window,
            #[cfg(target_os = "macos")]
            corner_mask: None,
        })
    }
}

impl GpuTerminalSurface {
    fn resize(&mut self, width: u32, height: u32, scale_factor: f32) {
        self.config.width = width.max(1);
        self.config.height = height.max(1);
        if (self.scale_factor - scale_factor).abs() > f32::EPSILON {
            let logical_size = self.font.size / self.scale_factor;
            let logical_cell_width = self.font.cell_width / self.scale_factor;
            let logical_cell_height = self.font.cell_height / self.scale_factor;
            self.scale_factor = scale_factor;
            self.font.size = logical_size * scale_factor;
            self.font.cell_width = logical_cell_width * scale_factor;
            self.font.cell_height = logical_cell_height * scale_factor;
            self.prepared_rows.clear();
            self.prepared_cursor = None;
            self.prepared_colors = None;
        }
        self.surface.configure(&self.device, &self.config);
    }

    fn render(&mut self, snapshot: &NativeTerminalSnapshot) -> Result<bool, String> {
        self.prepare_rows(snapshot);
        self.viewport.update(
            &self.queue,
            Resolution {
                width: self.config.width,
                height: self.config.height,
            },
        );
        let bounds = TextBounds {
            left: 0,
            top: 0,
            right: self.config.width as i32,
            bottom: self.config.height as i32,
        };
        let text_areas = self
            .row_buffers
            .iter()
            .enumerate()
            .map(|(row, buffer)| TextArea {
                buffer,
                left: 2.0 * self.scale_factor,
                top: row as f32 * self.font.cell_height,
                scale: 1.0,
                bounds,
                default_color: glyph_color(snapshot.default_fg),
                custom_glyphs: &[],
            });
        self.text_renderer
            .prepare(
                &self.device,
                &self.queue,
                &mut self.font_system,
                &mut self.atlas,
                &self.viewport,
                text_areas,
                &mut self.swash_cache,
            )
            .map_err(|error| format!("Failed to prepare terminal glyphs: {error}"))?;

        let vertices =
            rectangle_vertices(snapshot, &self.font, self.config.width, self.config.height);
        let vertex_buffer = (!vertices.is_empty()).then(|| {
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("otto terminal rectangles"),
                    contents: bytemuck::cast_slice(&vertices),
                    usage: wgpu::BufferUsages::VERTEX,
                })
        });

        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => frame,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(false)
            }
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Suboptimal(_) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(false);
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                self.surface = self
                    .instance
                    .create_surface(SurfaceTarget::Window(Box::new(self.window.clone())))
                    .map_err(|error| error.to_string())?;
                self.surface.configure(&self.device, &self.config);
                return Ok(false);
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                return Err("Terminal GPU surface validation failed".into())
            }
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("otto terminal frame"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("otto terminal render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu_color(snapshot.default_bg)),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            if let Some(vertex_buffer) = &vertex_buffer {
                pass.set_pipeline(&self.rect_pipeline);
                pass.set_vertex_buffer(0, vertex_buffer.slice(..));
                pass.draw(0..vertices.len() as u32, 0..1);
            }
            self.text_renderer
                .render(&self.atlas, &self.viewport, &mut pass)
                .map_err(|error| format!("Failed to render terminal glyphs: {error}"))?;
        }
        self.queue.submit(Some(encoder.finish()));
        self.queue.present(frame);
        self.atlas.trim();
        Ok(true)
    }

    fn prepare_rows(&mut self, snapshot: &NativeTerminalSnapshot) {
        while self.row_buffers.len() < snapshot.rows as usize {
            self.row_buffers.push(Buffer::new(
                &mut self.font_system,
                Metrics::new(self.font.size, self.font.cell_height),
            ));
        }
        self.row_buffers.truncate(snapshot.rows as usize);
        self.prepared_rows.truncate(snapshot.rows as usize);
        let cursor = (
            snapshot.cursor.row,
            snapshot.cursor.col,
            snapshot.cursor.visible,
            snapshot.cursor.shape,
        );
        let colors = (
            snapshot.default_fg,
            snapshot.default_bg,
            snapshot.selection_fg,
        );
        let colors_changed = self.prepared_colors != Some(colors);
        let previous_cursor = self.prepared_cursor;

        for (row_index, buffer) in self.row_buffers.iter_mut().enumerate() {
            let Some(row) = snapshot.rows_data.get(row_index) else {
                continue;
            };
            let cursor_row_changed = previous_cursor
                .is_some_and(|previous| previous.0 as usize == row_index && previous != cursor)
                || (cursor.0 as usize == row_index && previous_cursor != Some(cursor));
            if !colors_changed
                && !cursor_row_changed
                && self.prepared_rows.get(row_index) == Some(row)
            {
                continue;
            }
            let span_texts = row
                .cells
                .iter()
                .map(|cell| cell_text(cell))
                .collect::<Vec<_>>();
            let attrs = row
                .cells
                .iter()
                .enumerate()
                .map(|(column, cell)| {
                    cell_attrs(
                        cell,
                        snapshot.default_fg,
                        snapshot.default_bg,
                        snapshot.selection_fg,
                        snapshot.cursor.visible
                            && snapshot.cursor.shape == "block"
                            && snapshot.cursor.row as usize == row_index
                            && snapshot.cursor.col as usize == column,
                        &self.font.family,
                    )
                })
                .collect::<Vec<_>>();
            let spans = span_texts
                .iter()
                .zip(attrs)
                .map(|(text, attrs)| (text.as_str(), attrs));
            let default_attrs = Attrs::new().family(Family::Name(&self.font.family));
            buffer.set_metrics_and_size(
                Metrics::new(self.font.size, self.font.cell_height),
                Some(snapshot.cols as f32 * self.font.cell_width),
                Some(self.font.cell_height),
            );
            buffer.set_monospace_width(Some(self.font.cell_width));
            buffer.set_rich_text(spans, &default_attrs, Shaping::Advanced, None);
            buffer.shape_until_scroll(&mut self.font_system, false);
            if row_index < self.prepared_rows.len() {
                self.prepared_rows[row_index] = row.clone();
            } else {
                self.prepared_rows.push(row.clone());
            }
        }
        self.prepared_cursor = Some(cursor);
        self.prepared_colors = Some(colors);
    }
}

/// Measures the shaped advance of a reference glyph in the font the GPU font
/// system actually resolved. The JS canvas measurement can disagree with it
/// (different family resolution, hinting, or fallback), and any mismatch
/// accumulates across columns: the rect grid, cursor, and right-aligned TUI
/// content drift away from the shaped text.
fn measure_cell_advance(
    font_system: &mut FontSystem,
    family: &str,
    font_size: f32,
    line_height: f32,
) -> Option<f32> {
    let mut buffer = Buffer::new(font_system, Metrics::new(font_size, line_height));
    buffer.set_metrics_and_size(
        Metrics::new(font_size, line_height),
        Some(font_size * 8.0),
        Some(line_height),
    );
    let attrs = Attrs::new().family(Family::Name(family));
    buffer.set_rich_text([("M", attrs.clone())], &attrs, Shaping::Advanced, None);
    buffer.shape_until_scroll(font_system, false);
    let run = buffer.layout_runs().next()?;
    let glyph = run.glyphs.first()?;
    Some(glyph.w)
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct RectVertex {
    position: [f32; 2],
    color: [f32; 4],
}

fn create_rect_pipeline(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("otto terminal rectangle shader"),
        source: wgpu::ShaderSource::Wgsl(RECT_SHADER.into()),
    });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("otto terminal rectangle layout"),
        bind_group_layouts: &[],
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("otto terminal rectangle pipeline"),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            compilation_options: Default::default(),
            buffers: &[Some(wgpu::VertexBufferLayout {
                array_stride: std::mem::size_of::<RectVertex>() as u64,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &[
                    wgpu::VertexAttribute {
                        format: wgpu::VertexFormat::Float32x2,
                        offset: 0,
                        shader_location: 0,
                    },
                    wgpu::VertexAttribute {
                        format: wgpu::VertexFormat::Float32x4,
                        offset: std::mem::size_of::<[f32; 2]>() as u64,
                        shader_location: 1,
                    },
                ],
            })],
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: None,
        cache: None,
    })
}

fn rectangle_vertices(
    snapshot: &NativeTerminalSnapshot,
    font: &ResolvedFont,
    width: u32,
    height: u32,
) -> Vec<RectVertex> {
    let mut vertices = Vec::new();
    for (row_index, row) in snapshot.rows_data.iter().enumerate() {
        for (col_index, cell) in row.cells.iter().enumerate() {
            let mut foreground = cell.fg.unwrap_or(snapshot.default_fg);
            let mut background = cell.bg.unwrap_or(snapshot.default_bg);
            if cell.inverse {
                std::mem::swap(&mut foreground, &mut background);
            }
            if cell.selected {
                foreground = snapshot.selection_fg;
                background = snapshot.selection_bg;
            }
            let is_cursor = snapshot.cursor.visible
                && snapshot.cursor.col as usize == col_index
                && snapshot.cursor.row as usize == row_index;
            if let Some(sprite) = branch_sprite(cell) {
                push_branch_sprite(
                    &mut vertices,
                    col_index as f32 * font.cell_width,
                    row_index as f32 * font.cell_height,
                    font.cell_width,
                    font.cell_height,
                    sprite,
                    foreground,
                    width,
                    height,
                );
            }
            if cell.bg.is_some()
                || cell.inverse
                || cell.selected
                || (is_cursor && snapshot.cursor.shape == "block")
            {
                let color = if is_cursor && snapshot.cursor.shape == "block" {
                    snapshot.cursor.color.unwrap_or(snapshot.default_fg)
                } else {
                    background
                };
                push_rect(
                    &mut vertices,
                    col_index as f32 * font.cell_width,
                    row_index as f32 * font.cell_height,
                    if cell.wide {
                        font.cell_width * 2.0
                    } else {
                        font.cell_width
                    },
                    font.cell_height,
                    color,
                    width,
                    height,
                );
            }
            if cell.underline {
                push_rect(
                    &mut vertices,
                    col_index as f32 * font.cell_width,
                    (row_index as f32 + 1.0) * font.cell_height - 2.0,
                    font.cell_width,
                    1.0,
                    foreground,
                    width,
                    height,
                );
            }
            if cell.strikethrough {
                push_rect(
                    &mut vertices,
                    col_index as f32 * font.cell_width,
                    row_index as f32 * font.cell_height + font.cell_height / 2.0,
                    font.cell_width,
                    1.0,
                    foreground,
                    width,
                    height,
                );
            }
        }
    }

    if snapshot.cursor.visible {
        let x = snapshot.cursor.col as f32 * font.cell_width;
        let y = snapshot.cursor.row as f32 * font.cell_height;
        let color = snapshot.cursor.color.unwrap_or(snapshot.default_fg);
        match snapshot.cursor.shape {
            "bar" => push_rect(
                &mut vertices,
                x,
                y,
                2.0,
                font.cell_height,
                color,
                width,
                height,
            ),
            "underline" => push_rect(
                &mut vertices,
                x,
                y + font.cell_height - 2.0,
                font.cell_width,
                2.0,
                color,
                width,
                height,
            ),
            "blockHollow" => {
                push_rect(
                    &mut vertices,
                    x,
                    y,
                    font.cell_width,
                    1.0,
                    color,
                    width,
                    height,
                );
                push_rect(
                    &mut vertices,
                    x,
                    y + font.cell_height - 1.0,
                    font.cell_width,
                    1.0,
                    color,
                    width,
                    height,
                );
                push_rect(
                    &mut vertices,
                    x,
                    y,
                    1.0,
                    font.cell_height,
                    color,
                    width,
                    height,
                );
                push_rect(
                    &mut vertices,
                    x + font.cell_width - 1.0,
                    y,
                    1.0,
                    font.cell_height,
                    color,
                    width,
                    height,
                );
            }
            _ => {}
        }
    }
    vertices
}

#[allow(clippy::too_many_arguments)]
fn push_rect(
    vertices: &mut Vec<RectVertex>,
    x: f32,
    y: f32,
    rect_width: f32,
    rect_height: f32,
    color: NativeTerminalRgb,
    width: u32,
    height: u32,
) {
    let left = x / width as f32 * 2.0 - 1.0;
    let right = (x + rect_width) / width as f32 * 2.0 - 1.0;
    let top = 1.0 - y / height as f32 * 2.0;
    let bottom = 1.0 - (y + rect_height) / height as f32 * 2.0;
    let color = color_array(color);
    vertices.extend_from_slice(&[
        RectVertex {
            position: [left, top],
            color,
        },
        RectVertex {
            position: [right, top],
            color,
        },
        RectVertex {
            position: [right, bottom],
            color,
        },
        RectVertex {
            position: [left, top],
            color,
        },
        RectVertex {
            position: [right, bottom],
            color,
        },
        RectVertex {
            position: [left, bottom],
            color,
        },
    ]);
}

fn cell_text(cell: &NativeTerminalCell) -> String {
    if cell.spacer || cell.text.is_empty() || branch_sprite(cell).is_some() {
        " ".into()
    } else {
        cell.text.clone()
    }
}

fn cell_attrs<'a>(
    cell: &NativeTerminalCell,
    default_fg: NativeTerminalRgb,
    default_bg: NativeTerminalRgb,
    selection_fg: NativeTerminalRgb,
    block_cursor: bool,
    family: &'a str,
) -> Attrs<'a> {
    let foreground = if block_cursor {
        cell.bg.unwrap_or(default_bg)
    } else if cell.selected {
        selection_fg
    } else if cell.inverse {
        cell.bg.unwrap_or(default_fg)
    } else {
        cell.fg.unwrap_or(default_fg)
    };
    let mut attrs = Attrs::new()
        .family(Family::Name(family))
        .color(glyph_color(foreground));
    if cell.bold {
        attrs = attrs.weight(Weight::BOLD);
    }
    if cell.italic {
        attrs = attrs.style(FontStyle::Italic);
    }
    attrs
}

#[derive(Clone, Copy)]
struct BranchSprite {
    up: bool,
    down: bool,
    left: bool,
    right: bool,
    filled: bool,
}

fn branch_sprite(cell: &NativeTerminalCell) -> Option<BranchSprite> {
    let mut chars = cell.text.chars();
    let codepoint = chars.next()? as u32;
    if chars.next().is_some() || !(0x0f5ee..=0x0f60d).contains(&codepoint) {
        return None;
    }
    let pair = (codepoint - 0x0f5ee) / 2;
    let directions = [
        0b0000, 0b0001, 0b0010, 0b0011, 0b0100, 0b1000, 0b1100, 0b0101, 0b0110, 0b1001, 0b1010,
        0b1101, 0b1110, 0b0111, 0b1011, 0b1111,
    ];
    let bits = *directions.get(pair as usize)?;
    Some(BranchSprite {
        right: bits & 0b0001 != 0,
        left: bits & 0b0010 != 0,
        down: bits & 0b0100 != 0,
        up: bits & 0b1000 != 0,
        filled: (codepoint - 0x0f5ee).is_multiple_of(2),
    })
}

#[allow(clippy::too_many_arguments)]
fn push_branch_sprite(
    vertices: &mut Vec<RectVertex>,
    x: f32,
    y: f32,
    cell_width: f32,
    cell_height: f32,
    sprite: BranchSprite,
    color: NativeTerminalRgb,
    width: u32,
    height: u32,
) {
    let thickness = (cell_width.min(cell_height) / 8.0).round().max(1.0);
    let center_x = x + cell_width / 2.0;
    let center_y = y + cell_height / 2.0;
    let radius = (cell_width.min(cell_height) / 3.0).max(thickness);
    if sprite.up {
        push_rect(
            vertices,
            center_x - thickness / 2.0,
            y,
            thickness,
            cell_height / 2.0 - radius,
            color,
            width,
            height,
        );
    }
    if sprite.down {
        push_rect(
            vertices,
            center_x - thickness / 2.0,
            center_y + radius,
            thickness,
            cell_height / 2.0 - radius,
            color,
            width,
            height,
        );
    }
    if sprite.left {
        push_rect(
            vertices,
            x,
            center_y - thickness / 2.0,
            cell_width / 2.0 - radius,
            thickness,
            color,
            width,
            height,
        );
    }
    if sprite.right {
        push_rect(
            vertices,
            center_x + radius,
            center_y - thickness / 2.0,
            cell_width / 2.0 - radius,
            thickness,
            color,
            width,
            height,
        );
    }
    push_circle(
        vertices,
        center_x,
        center_y,
        radius,
        if sprite.filled { 0.0 } else { thickness },
        color,
        width,
        height,
    );
}

#[allow(clippy::too_many_arguments)]
fn push_circle(
    vertices: &mut Vec<RectVertex>,
    center_x: f32,
    center_y: f32,
    radius: f32,
    ring_width: f32,
    color: NativeTerminalRgb,
    width: u32,
    height: u32,
) {
    const SEGMENTS: usize = 20;
    let inner_radius = (radius - ring_width).max(0.0);
    let color = color_array(color);
    let point = |angle: f32, radius: f32| {
        let x = center_x + angle.cos() * radius;
        let y = center_y + angle.sin() * radius;
        [x / width as f32 * 2.0 - 1.0, 1.0 - y / height as f32 * 2.0]
    };
    for index in 0..SEGMENTS {
        let start = index as f32 / SEGMENTS as f32 * std::f32::consts::TAU;
        let end = (index + 1) as f32 / SEGMENTS as f32 * std::f32::consts::TAU;
        let outer_start = point(start, radius);
        let outer_end = point(end, radius);
        if inner_radius <= 0.0 {
            vertices.extend_from_slice(&[
                RectVertex {
                    position: point(0.0, 0.0),
                    color,
                },
                RectVertex {
                    position: outer_start,
                    color,
                },
                RectVertex {
                    position: outer_end,
                    color,
                },
            ]);
        } else {
            let inner_start = point(start, inner_radius);
            let inner_end = point(end, inner_radius);
            vertices.extend_from_slice(&[
                RectVertex {
                    position: outer_start,
                    color,
                },
                RectVertex {
                    position: outer_end,
                    color,
                },
                RectVertex {
                    position: inner_end,
                    color,
                },
                RectVertex {
                    position: outer_start,
                    color,
                },
                RectVertex {
                    position: inner_end,
                    color,
                },
                RectVertex {
                    position: inner_start,
                    color,
                },
            ]);
        }
    }
}

fn color_array(color: NativeTerminalRgb) -> [f32; 4] {
    [
        srgb_to_linear(color.r) as f32,
        srgb_to_linear(color.g) as f32,
        srgb_to_linear(color.b) as f32,
        1.0,
    ]
}

fn glyph_color(color: NativeTerminalRgb) -> GlyphColor {
    GlyphColor::rgb(color.r, color.g, color.b)
}

fn wgpu_color(color: NativeTerminalRgb) -> wgpu::Color {
    wgpu::Color {
        r: srgb_to_linear(color.r),
        g: srgb_to_linear(color.g),
        b: srgb_to_linear(color.b),
        a: 1.0,
    }
}

fn srgb_to_linear(channel: u8) -> f64 {
    let value = channel as f64 / 255.0;
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn overlay_label(owner_label: &str, session_id: &str) -> String {
    format!(
        "terminal-gpu-{}-{}",
        safe_label(owner_label),
        safe_label(session_id)
    )
}

fn safe_label(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn load_embedded_fonts(app: &AppHandle<Wry>, font_system: &mut FontSystem) {
    for path in font_paths(app) {
        let Ok(data) = std::fs::read(path) else {
            continue;
        };
        font_system.db_mut().load_font_data(data);
    }
}

fn font_paths(app: &AppHandle<Wry>) -> Vec<PathBuf> {
    let files = [
        "JetBrainsMonoNerdFont-Regular.ttf",
        "JetBrainsMonoNerdFont-Bold.ttf",
        "JetBrainsMonoNerdFont-Italic.ttf",
        "JetBrainsMonoNerdFont-BoldItalic.ttf",
    ];
    let mut paths = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        for file in files {
            paths.push(resources.join("resources/fonts").join(file));
            paths.push(resources.join("fonts").join(file));
        }
    }
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        for file in files {
            paths.push(
                PathBuf::from(&manifest_dir)
                    .join("resources/fonts")
                    .join(file),
            );
        }
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(text: &str) -> NativeTerminalCell {
        NativeTerminalCell {
            text: text.into(),
            ..Default::default()
        }
    }

    #[test]
    fn recognizes_canvas_branch_private_use_glyphs() {
        let filled = branch_sprite(&cell("\u{f5ee}")).unwrap();
        assert!(filled.filled);
        assert!(!filled.up && !filled.down && !filled.left && !filled.right);

        let connected = branch_sprite(&cell("\u{f60c}")).unwrap();
        assert!(connected.filled);
        assert!(connected.up && connected.down && connected.left && connected.right);
        assert!(branch_sprite(&cell("A")).is_none());
    }

    #[test]
    fn overlay_labels_are_safe_and_window_scoped() {
        assert_eq!(
            overlay_label("machine/main", "terminal:id"),
            "terminal-gpu-machine_main-terminal_id"
        );
    }

    #[test]
    fn converts_css_srgb_colors_for_an_srgb_gpu_surface() {
        assert_eq!(srgb_to_linear(0), 0.0);
        assert_eq!(srgb_to_linear(255), 1.0);
        assert!((srgb_to_linear(20) - 0.006995).abs() < 0.000001);
    }
}
