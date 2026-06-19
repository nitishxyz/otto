# Local streaming dictation with whisper.cpp

## Goal

Build local, private, first-party dictation into otto with dumb clients and a server-owned speech-to-text runtime.

Clients should only:

1. request microphone permission,
2. capture audio with platform audio APIs,
3. stream audio frames to the otto server,
4. receive transcript events, and
5. insert the final text into the input.

The otto server should own everything else:

- dictation session lifecycle
- audio buffering
- model installation
- whisper.cpp runtime bootstrapping
- transcription
- partial/final transcript events
- cleanup

```text
web / desktop / future clients
  -> microphone audio stream
  -> otto server WebSocket
  -> dictation session manager
  -> local whisper.cpp runtime
  -> downloaded local model
  -> transcript events
  -> client inserts text
```

## Key product constraint

Audio must be streamed to the backend while the user is speaking. The client should not record a long blob and upload it only after stop.

The first version can still return only a final transcript, but the audio bytes should already be on the server by the time the user stops recording. This removes the extra upload delay for long prompts and sets up true partial transcription later.

## Recommended v1 protocol

Use WebSocket for bidirectional dictation sessions.

Reasons:

- existing server already exports Bun/Hono WebSocket support for terminal I/O
- works naturally for binary audio frames plus JSON control/events
- compatible with local web, desktop, and tunneled sessions when the tunnel supports WebSocket upgrade
- avoids full-duplex `fetch` limitations across browsers
- keeps clients simple

Primary endpoint:

```http
GET /v1/dictation/sessions/{id}/ws
```

Supporting HTTP endpoints:

```http
GET  /v1/dictation/status
GET  /v1/dictation/models
POST /v1/dictation/models/{model}/install
POST /v1/dictation/sessions
GET  /v1/dictation/sessions/{id}
DELETE /v1/dictation/sessions/{id}
```

## Session flow

```text
client -> POST /v1/dictation/sessions
server -> { id, wsUrl, requestedFormat, model, modelInstalled }

client -> WebSocket connect
client -> JSON start message
client -> binary PCM frames while speaking
server -> optional partial transcript events
client -> JSON stop message
server -> final transcript event
server -> close or wait for another start
```

## WebSocket message protocol

### Client JSON messages

#### `start`

Sent once after opening the socket.

```json
{
  "type": "start",
  "model": "small.en-q5_1",
  "language": "en",
  "format": {
    "encoding": "pcm_s16le",
    "sampleRate": 16000,
    "channels": 1
  },
  "partialResults": false
}
```

#### `stop`

Sent when the user stops speaking.

```json
{
  "type": "stop"
}
```

#### `cancel`

Sent when the user cancels dictation or navigates away.

```json
{
  "type": "cancel"
}
```

### Client binary messages

After `start`, the client sends raw audio frames as binary WebSocket messages.

Recommended v1 frame format:

```text
PCM signed 16-bit little-endian
16 kHz
mono
20-100 ms per frame
```

At 16 kHz mono PCM16, bandwidth is about 32 KB/s. This is acceptable for local and tunneled usage.

### Server JSON events

#### `ready`

```json
{
  "type": "ready",
  "sessionId": "dict_...",
  "model": "small.en-q5_1",
  "format": {
    "encoding": "pcm_s16le",
    "sampleRate": 16000,
    "channels": 1
  }
}
```

#### `recording`

Acknowledges that the server is receiving and buffering audio.

```json
{
  "type": "recording",
  "receivedMs": 1240
}
```

#### `partial`

Optional. Not required for v1.

```json
{
  "type": "partial",
  "text": "open the file",
  "startMs": 0,
  "endMs": 2200
}
```

#### `final`

```json
{
  "type": "final",
  "text": "Open the file and explain the error.",
  "language": "en",
  "model": "small.en-q5_1",
  "durationMs": 4200
}
```

#### `error`

```json
{
  "type": "error",
  "code": "DICTATION_MODEL_MISSING",
  "message": "Install the local dictation model before starting."
}
```

## Why not MediaRecorder chunks for v1?

`MediaRecorder` is simpler for clients, but produces browser-specific containers/codecs:

- Chrome often emits WebM/Opus
- Safari often emits MP4/AAC
- desktop/native clients may emit M4A, CAF, WAV, or platform-specific formats

Streaming compressed containers into whisper.cpp reliably would require server-side decoding, likely ffmpeg, and introduces more packaging/security complexity.

For v1, prefer raw PCM frames. The client is still dumb: it captures audio, performs minimal downmix/resampling, and streams bytes. The server remains responsible for all transcription logic.

A future fallback can accept MediaRecorder chunks if we add a safe decoder pipeline.

## Phased implementation plan

## Phase 1 — Server API skeleton

Outcome: dictation routes and session lifecycle exist, with a fake transcription backend.

Add:

```text
packages/server/src/routes/dictation.ts
packages/server/src/dictation/types.ts
packages/server/src/dictation/sessions.ts
packages/server/src/dictation/protocol.ts
packages/server/src/dictation/paths.ts
```

Register dictation routes in all server constructors:

- `initApp`
- `createStandaloneApp`
- `createEmbeddedApp`

Initial routes:

```http
GET  /v1/dictation/status
GET  /v1/dictation/models
POST /v1/dictation/sessions
GET  /v1/dictation/sessions/{id}/ws
DELETE /v1/dictation/sessions/{id}
```

Use `upgradeWebSocket` from `packages/server/src/ws.ts`, matching the existing terminal route pattern.

The WebSocket route should initially:

- accept `start`
- accept binary PCM frames
- count received bytes / duration
- accept `stop`
- return a fake final transcript
- cleanup session state

This locks protocol shape before integrating whisper.cpp.

## Phase 2 — Audio session buffering

Outcome: streamed audio is written incrementally on the server.

Add a dictation session manager that tracks:

```ts
type DictationSession = {
  id: string;
  status: 'created' | 'recording' | 'transcribing' | 'completed' | 'cancelled' | 'error';
  model: string;
  language: string;
  format: AudioFormat;
  createdAt: string;
  updatedAt: string;
  receivedBytes: number;
  receivedMs: number;
  pcmPath: string;
  wavPath: string;
};
```

For each binary message:

1. validate the session is recording,
2. enforce max duration / max bytes,
3. append bytes to a temp PCM file,
4. update received duration,
5. optionally emit `recording` progress.

On `stop`:

1. close the PCM writer,
2. wrap PCM as WAV, or pass PCM directly to the engine if supported,
3. mark the session `transcribing`,
4. run transcription,
5. emit `final`,
6. cleanup temp files after a short retention window.

Suggested temp location:

```text
<global otto runtime>/dictation/tmp/{sessionId}.pcm
<global otto runtime>/dictation/tmp/{sessionId}.wav
```

## Phase 3 — Client-side streaming recorder

Outcome: current mic UI streams PCM frames to the local server instead of using browser/native dictation.

From the existing audio branch, keep:

- mic button UX
- recording state
- stop button
- waveform component
- base-text append behavior in `ChatInput`

Replace Web Speech API usage with a streaming recorder.

Recommended web-sdk files:

```text
packages/web-sdk/src/hooks/useAudioStreamRecorder.ts
packages/web-sdk/src/hooks/useStreamingDictation.ts
packages/web-sdk/src/components/chat/LiveWaveform.tsx
```

`useAudioStreamRecorder` responsibilities:

- request mic permission
- create `AudioContext`
- create waveform `AnalyserNode`
- capture samples through `AudioWorklet` where available
- fallback to `ScriptProcessorNode` only if needed
- downmix to mono
- resample to 16 kHz
- convert Float32 samples to PCM16
- emit binary frames every 20-100 ms

`useStreamingDictation` responsibilities:

- create dictation session through `@ottocode/api`
- connect WebSocket
- send `start`
- stream frames from `useAudioStreamRecorder`
- send `stop`
- receive `final`
- expose state to `ChatInput`

Client states:

```ts
type DictationClientState =
  | 'idle'
  | 'checking'
  | 'installing-model'
  | 'connecting'
  | 'recording'
  | 'stopping'
  | 'transcribing'
  | 'completed'
  | 'error';
```

For v1, clients should not perform transcription, VAD, diarization, or prompt cleanup.

## Phase 4 — Model manager

Outcome: local models are installed on demand and verified.

Add:

```text
packages/server/src/dictation/manifest.ts
packages/server/src/dictation/models.ts
```

Manifest should include:

```ts
type DictationModel = {
  id: string;
  label: string;
  language: 'en' | 'multi';
  sizeBytes: number;
  url: string;
  sha256: string;
  recommended?: boolean;
};
```

Recommended default:

```text
small.en-q5_1
```

Also expose:

```text
tiny.en-q5_1       fastest English
base.en-q5_1       fast English
small.en-q5_1      balanced English, recommended
large-v3-turbo-q5_0 accurate multilingual, optional
```

Install flow:

1. download to `*.download`,
2. enforce expected max size,
3. verify SHA-256,
4. atomically rename to final model path,
5. report install state.

Model files should not be bundled into the otto binary.

## Phase 4.5 — Model download UI

Outcome: users can understand, install, inspect, and remove local dictation models without needing to trigger recording first.

There should be two entry points for model installation:

1. first-use prompt from the chat input when a user starts recording and no usable model is installed,
2. a persistent settings surface for managing dictation models manually.

Recommended UI surfaces:

```text
Settings modal
  -> Dictation / Voice section
    -> Local dictation status
    -> Installed model
    -> Available models
    -> Download / Pause / Retry / Remove actions
```

The first-use flow should be lightweight:

```text
user clicks mic
  -> server reports DICTATION_MODEL_MISSING
  -> client shows "Download local dictation model?"
  -> user confirms
  -> model download progress is shown
  -> recording starts or user clicks mic again
```

The settings flow should support proactive model management:

- show whether local dictation is available on this machine,
- show installed model and disk usage,
- show recommended default model,
- allow downloading other models,
- allow removing installed models,
- show download progress and checksum/verification state,
- show clear errors for failed downloads or unsupported platforms.

Suggested web-sdk files:

```text
packages/web-sdk/src/components/settings/DictationSettings.tsx
packages/web-sdk/src/hooks/useDictationModels.ts
```

The client should still remain dumb. The UI should call server APIs for status, model list, installation, and removal; it should not know about model file paths or whisper.cpp internals.

## Phase 5 — Embed whisper.cpp runtime

Outcome: otto ships the speech runtime, while models remain on-demand.

Use the existing embedded binary pattern already used for ripgrep.

Extend:

```text
scripts/download-vendor-bins.sh
scripts/prepare-embedded-bins.ts
apps/cli/src/bootstrap-bins.ts
```

Add generated file:

```text
apps/cli/src/generated/embedded-whisper.ts
```

Vendor layout:

```text
vendor/bin/darwin-arm64/whisper-server
vendor/bin/darwin-x64/whisper-server
vendor/bin/linux-x64/whisper-server
vendor/bin/linux-arm64/whisper-server
vendor/bin/windows-x64/whisper-server.exe
```

At runtime, extract to:

```text
~/.config/otto/bin/whisper-server
```

or the platform-appropriate global otto runtime dir.

The server should bind whisper.cpp only to `127.0.0.1` if using the whisper server sidecar. The client never connects to whisper.cpp directly.

## Phase 6 — Real transcription integration

Outcome: streamed PCM becomes a real transcript.

Start with streaming-final mode:

```text
client streams audio while recording
server buffers PCM incrementally
on stop, server transcribes buffered WAV
server sends final transcript
```

This already avoids the long post-recording upload delay.

Implementation options:

### Option A — invoke whisper CLI per completed session

Simpler first integration.

```text
stop -> write WAV -> spawn whisper-cli -> parse output -> final event
```

Pros:

- easier to debug
- no long-lived sidecar process lifecycle initially
- lower server complexity

Cons:

- model load on every transcription unless whisper.cpp provides caching elsewhere
- slower repeated dictation

### Option B — keep whisper-server warm

Better final architecture.

```text
server starts whisper-server with selected model
stop -> proxy WAV to local whisper-server /inference
```

Pros:

- model stays warm
- faster repeated dictation
- closer to long-term architecture

Cons:

- process manager needed
- port allocation and health checks needed

Recommended sequence:

1. implement Option A for first end-to-end proof,
2. switch to Option B once API/client flow works.

## Phase 7 — Overlap transcription with recording

Outcome: less wait after stop for long dictation.

Once streaming-final works, add rolling background transcription.

Server receives PCM continuously and segments it into windows, for example:

```text
window length: 8-12 seconds
overlap: 1 second
silence-aware split: later with VAD
```

While the user is still speaking:

1. server writes PCM,
2. server periodically snapshots closed windows,
3. server transcribes completed windows in the background,
4. server emits optional `partial` events,
5. on stop, server transcribes only the remaining tail and merges results.

This is the phase that makes long dictation feel fast, because compute overlaps with speech.

For v1, do not block launch on this. The critical first step is streaming bytes to the server while recording.

## Phase 8 — Tunnels and remote clients

Outcome: dictation works when clients reach otto through a tunnel.

Primary tunnel requirement: WebSocket upgrade support.

If the existing tunnel supports WebSocket, the dictation endpoint should work naturally:

```text
wss://<tunnel-host>/v1/dictation/sessions/{id}/ws
```

If a tunnel/proxy cannot support WebSockets, add a fallback transport:

```http
POST /v1/dictation/sessions/{id}/chunks
GET  /v1/dictation/sessions/{id}/events
POST /v1/dictation/sessions/{id}/stop
```

Fallback shape:

- client POSTs binary PCM chunks over normal HTTP
- server emits transcript/progress over SSE
- session id preserves ordering and lifecycle

Do not implement fallback first unless required by the tunnel implementation. WebSocket should be the primary path.

Security for tunneled dictation:

- require existing otto auth/session protections where applicable
- cap max session duration
- cap max bytes per session
- close idle sockets
- never expose whisper.cpp sidecar publicly
- do not log transcript text by default

## Phase 9 — API client and OpenAPI

Outcome: HTTP lifecycle APIs are generated; WebSocket helper is hand-written.

OpenAPI should document:

- status
- models
- install model
- create session
- delete session
- WebSocket upgrade endpoint

Generated clients cannot consume WebSocket upgrades directly, matching the existing terminal WebSocket note. Add a small helper in web-sdk for deriving the `ws://` / `wss://` URL from the API base URL.

Expected files:

```text
packages/server/src/openapi/route.ts
packages/server/src/routes/openapi.ts
packages/api/openapi.json
packages/api/src/generated/*
packages/web-sdk/src/lib/api-client/dictation.ts
```

Run after route changes:

```bash
bun run --filter @ottocode/api generate
```

## Phase 10 — CLI/debug commands

Outcome: dictation can be tested without the web UI.

Optional commands:

```bash
otto dictation status
otto dictation models
otto dictation install small.en-q5_1
otto dictation transcribe ./sample.wav
```

A streaming CLI command can come later:

```bash
otto dictation listen
```

The first debug priority is server route tests plus a simple WAV transcription path.

## Phase 11 — Tests

Add tests under `tests/`:

```text
tests/dictation-routes.test.ts
tests/dictation-session-protocol.test.ts
tests/dictation-model-install.test.ts
tests/dictation-audio-buffer.test.ts
```

Test without real whisper.cpp by injecting a fake transcription runner.

Test cases:

- create session
- WebSocket rejects binary before `start`
- WebSocket accepts `start`
- binary frames update received byte count
- `stop` returns final event
- `cancel` cleans up temp files
- oversized session is rejected
- missing model returns `DICTATION_MODEL_MISSING`
- install verifies checksum

Optional gated integration test:

```bash
OTTO_DICTATION_INTEGRATION=1 bun test tests/dictation-integration.test.ts
```

## Phase 12 — Error codes

Use stable error codes so clients can stay dumb.

```text
DICTATION_UNSUPPORTED_PLATFORM
DICTATION_MODEL_MISSING
DICTATION_MODEL_DOWNLOAD_FAILED
DICTATION_MODEL_CHECKSUM_FAILED
DICTATION_ENGINE_MISSING
DICTATION_SESSION_NOT_FOUND
DICTATION_SESSION_EXPIRED
DICTATION_AUDIO_FORMAT_UNSUPPORTED
DICTATION_AUDIO_TOO_LARGE
DICTATION_TRANSCRIBE_FAILED
DICTATION_TIMEOUT
```

Client behavior should be simple:

- model missing -> show install prompt
- mic denied -> show permission error
- socket failed -> show connection/tunnel error
- transcribe failed -> let user retry

## Zero-to-one implementation order

1. Add dictation route skeleton and WebSocket session protocol.
2. Add server PCM buffering and fake final transcript.
3. Add web-sdk streaming recorder and wire current mic UI to the WebSocket.
4. Add model manifest/install route.
5. Add whisper.cpp binary bootstrap.
6. Add real transcription on stop using buffered WAV.
7. Add warm whisper-server process manager.
8. Add optional partial transcript events from rolling windows.
9. Validate tunnel/WebSocket behavior.
10. Add docs, tests, and CLI debug commands.

## First demo target

The first meaningful demo should prove this flow:

```text
click mic
  -> model is already installed or prompt appears
  -> WebSocket connects to otto server
  -> client streams PCM frames while waveform animates
  -> server buffers received audio
click stop
  -> server transcribes buffered audio with whisper.cpp
  -> server sends final transcript
  -> ChatInput appends transcript to existing text
```

This satisfies the core architecture: dumb clients, streamed audio, server-owned local AI, and one backend path shared by web, desktop, and future clients.
