# Chat scrolling

`MessageThread` lets LegendList own the scroll offset and visible-row anchoring.
Streaming follows the live edge while the reader is at the bottom. Scrolling up
detaches follow; returning to the bottom, pressing **Scroll to bottom**, or sending
a new message resumes it. Incoming turns alone do not resume follow.

The native end threshold is a fraction of the viewport (0.01), not a pixel count.
It must stay small because LegendList also uses it to adjust the offset when the
composer's end inset grows, even with end-follow disabled. Visible-row anchoring
can increase `scrollTop` without moving the reader closer to the bottom; that
must not rearm follow.

## Regression checks

- Stream a long response at the bottom: new text stays visible without animation.
- Scroll up while streaming, both slightly and several screens: older text stays
  in place, including when the composer grows or a tool row changes height.
- Load earlier history while detached: the same visible row stays anchored.
- Return to the bottom or press **Scroll to bottom**: streaming follows again.

Automated coverage: `tests/thread-follow-state.test.ts` and
`tests/legend-list-thread-contract.test.ts`.
