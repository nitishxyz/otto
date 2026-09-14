# Browser control capabilities

The browser tool controls mounted Otto tabs. Use `open` explicitly to create a
controllable tab and `tabs` to discover its identifier.

On macOS desktop, clicks and supported keys use native input. Hover is accepted
only when WebKit confirms CSS `:hover`; otherwise the action returns an error.
The backend sends window-local mouse motion without moving the system cursor or
changing focus, then checks hover state for up to 250ms. WebKit may ignore this
local motion, in which case hover explicitly rejects rather than claiming success.
Native key input supports Enter, Tab, Backspace, Escape, and arrow keys, plus
single-character text. Unsupported shortcuts return an error rather than falling
back after an attempted native action. `type` retains its existing field-replacement
semantics, including select controls, rather than appending native keystrokes.
Native evaluation awaits promises through a function-body bridge without nested
page-side `eval`. Evaluation returns the final expression from a local async scope.

Native input, native async evaluation, and screenshots are advertised only on
macOS. Other desktop platforms use the available script executor; web iframes are
also constrained by same-origin access and CSP. Script keyboard fallback emulates
common defaults with untrusted events. It cannot provide native hover.

Desktop page popups preserve their original request and opener in separate native
windows. They are not registered as controllable Otto tabs. Otto does not recreate
them from a URL, which would lose POST bodies, window features, and opener state.
Downloads run through the host; dispatching a click does not confirm completion.

Inspection traverses open shadow roots; closed roots remain inaccessible. Network
recording wraps page fetch/XHR calls and supplements them with resource timings.
Missing resource methods/statuses are unknown. Worker traffic, navigation requests,
and pre-install request details are not available from this page-level recorder.
