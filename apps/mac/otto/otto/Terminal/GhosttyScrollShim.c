// Legacy shim kept so Xcode's synchronized file group has a valid C source.
// The GhosttyKit terminal path uses the full surface API and no longer calls
// libghostty-vt scroll viewport functions directly.
void otto_ghostty_scroll_shim_placeholder(void) {}
