// Inline JavaScript is also available in compiled executables (BUN_BE_BUN=1).
// The control channel carries the environment over stdin, never argv or logs.
// Bun's macOS kqueue ESRCH fallback can block in wait4 before draining the PTY
// (oven-sh/bun#42171; upstream fix #41732). Isolation alone does not prevent it:
// fd 3 gates exec until spawn returns, after the exit watcher is registered.
// exec preserves the PTY leader PID; the command never inherits the gate fd.
export const PTY_HELPER_SOURCE = String.raw`
import { closeSync, writeSync } from 'node:fs';
const MAX_FRAME = 1024 * 1024;
const MAX_OUTPUT = 2 * 1024 * 1024;
let proc;
let terminal;
let finished = false;
let losingParent = false;
let pending = '';
let blocked = false;
let pipeBlocked = false;
let outputBytes = 0;
let blockedTimer;
const decoder = new TextDecoder();
function signalTree(signal) {
  if (!proc) return;
  try { process.kill(-proc.pid, signal); }
  catch { try { proc.kill(signal); } catch {} }
}
function parentLost() {
  if (losingParent || finished) return;
  losingParent = true;
  clearTimeout(blockedTimer);
  process.stdin.destroy();
  signalTree('SIGCONT');
  signalTree('SIGTERM');
  // Retain the group identity even if the direct child exits before escalation.
  setTimeout(() => {
    signalTree('SIGKILL');
    terminal?.close();
    process.exit(1);
  }, 500);
}
function send(message, callback) {
  if (losingParent || finished) return;
  const frame = JSON.stringify(message) + '\n';
  const bytes = Buffer.byteLength(frame);
  if (message.type === 'data') outputBytes += bytes;
  if (bytes > MAX_FRAME || outputBytes > MAX_OUTPUT || process.stdout.writableLength + bytes > MAX_OUTPUT) {
    parentLost();
    return;
  }
  pipeBlocked = !process.stdout.write(frame, callback) || pipeBlocked;
  if ((pipeBlocked || outputBytes >= 256 * 1024) && !blocked) {
    blocked = true;
    signalTree('SIGSTOP');
    blockedTimer = setTimeout(parentLost, 5000);
  }
}
function resumeOutput() {
  if (!blocked || losingParent || pipeBlocked || outputBytes >= 128 * 1024) return;
  blocked = false;
  clearTimeout(blockedTimer);
  signalTree('SIGCONT');
}
process.stdout.on('drain', () => {
  pipeBlocked = false;
  resumeOutput();
});
process.stdout.on('error', parentLost);
function emitData(bytes) {
  // JSON escaping can expand data sixfold; keep individual frames well below the cap.
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    const data = decoder.decode(bytes.subarray(offset, offset + 16384), { stream: true });
    if (data) send({ type: 'data', data });
  }
}
function finish(exitCode) {
  if (finished || losingParent) return;
  terminal?.close();
  send({ type: 'exit', exitCode }, () => process.exit(0));
  finished = true;
  clearTimeout(blockedTimer);
  process.stdin.destroy();
  // A reader that vanished must never strand the helper while flushing exit.
  setTimeout(() => { signalTree('SIGKILL'); process.exit(1); }, 1000);
}
process.on('SIGTERM', parentLost);
process.on('SIGINT', parentLost);
process.stdin.on('end', parentLost);
process.stdin.on('close', parentLost);
process.stdin.on('error', parentLost);
process.stdin.setEncoding('utf8');
function handle(message) {
  if (!message || typeof message !== 'object') throw new Error();
  if (message.type === 'start') {
    if (proc || typeof message.command !== 'string' || !Array.isArray(message.args) || !message.args.every(arg => typeof arg === 'string')) throw new Error();
    const { command, args, options } = message;
    proc = Bun.spawn(['/bin/sh', '-c', 'read -r gate <&3 || exit 125; exec "$@" 3<&-', 'otto-pty', command, ...args], {
      cwd: options.cwd, env: options.env,
      stdio: ['inherit', 'inherit', 'inherit', 'pipe'],
      terminal: {
        name: options.name, cols: options.cols, rows: options.rows,
        data: (_terminal, bytes) => emitData(bytes),
      },
    });
    terminal = proc.terminal;
    if (!terminal) throw new Error();
    const gate = proc.stdio[3];
    try { writeSync(gate, '\n'); }
    finally { closeSync(gate); }
    send({ type: 'ready', pid: proc.pid });
    proc.exited.then((exitCode) => {
      const data = decoder.decode();
      if (data) send({ type: 'data', data });
      finish(exitCode);
    });
  } else if (message.type === 'write' && typeof message.data === 'string') terminal?.write(message.data);
  else if (message.type === 'resize' && Number.isInteger(message.cols) && Number.isInteger(message.rows) && message.cols > 0 && message.rows > 0 && message.cols <= 65535 && message.rows <= 65535) terminal?.resize(message.cols, message.rows);
  else if (message.type === 'kill' && ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGHUP'].includes(message.signal)) signalTree(message.signal);
  else if (message.type === 'outputAck' && Number.isSafeInteger(message.bytes) && message.bytes > 0 && message.bytes <= outputBytes) {
    outputBytes -= message.bytes;
    resumeOutput();
  }
  else throw new Error();
}
process.stdin.on('data', (data) => {
  if (losingParent || finished) return;
  pending += data;
  let newline;
  while ((newline = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    if (Buffer.byteLength(line) > MAX_FRAME) { parentLost(); return; }
    try { handle(JSON.parse(line)); send({ type: 'ack' }); }
    catch { parentLost(); return; }
  }
  if (Buffer.byteLength(pending) > MAX_FRAME) parentLost();
});
`;
