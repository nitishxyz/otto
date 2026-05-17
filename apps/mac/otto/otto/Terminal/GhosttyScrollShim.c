#include <stdint.h>

#define GHOSTTY_SCROLL_VIEWPORT_DELTA 2

typedef void *GhosttyTerminal;

typedef union {
    intptr_t delta;
    uint64_t _padding[2];
} GhosttyTerminalScrollViewportValue;

typedef struct {
    int32_t tag;
    GhosttyTerminalScrollViewportValue value;
} GhosttyTerminalScrollViewport;

extern void ghostty_terminal_scroll_viewport(
    GhosttyTerminal terminal,
    GhosttyTerminalScrollViewport behavior
);

void otto_ghostty_terminal_scroll_viewport_delta(GhosttyTerminal terminal, intptr_t delta) {
    if (terminal == 0) {
        return;
    }

    GhosttyTerminalScrollViewport behavior = {0};
    behavior.tag = GHOSTTY_SCROLL_VIEWPORT_DELTA;
    behavior.value.delta = delta;
    ghostty_terminal_scroll_viewport(terminal, behavior);
}
