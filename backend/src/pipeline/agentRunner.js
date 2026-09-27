// Runs one check as an isolated `opencode run --agent <id>` child process.
// All four checks are launched in parallel by the review runner.
// Contract: each agent writes summary.json to its work dir AND prints a
// short JSON object; we prefer the file, fall back to parsing stdout.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..'); // releaseguard/

const CHECK_TIMEOUT_MS = Number(process.env.RG_CHECK_TIMEOUT_MS || 900000);

/**
 * Locate the opencode binary.
 * On Windows the PATH entry is a shim (opencode.cmd / opencode.ps1) which
 * `spawn` cannot execute without a shell (and shell:true mangles quoted
 * prompts). The npm shim sits next to the real exe, so prefer that.
 */
export function resolveOpenCodeBin() {
  if (process.env.RG_OPENCODE_BIN) return process.env.RG_OPENCODE_BIN;
  if (process.platform !== 'win32') return 'opencode';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const exe = path.join(dir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
    if (fs.existsSync(exe)) return exe;
    if (fs.existsSync(path.join(dir, 'opencode.exe'))) return path.join(dir, 'opencode.exe');
  }
  return 'opencode';
}

/** Extract accumulated text-part content from `--format json` NDJSON events. */
export function extractAgentText(ndjson) {
  const byId = new Map();
  const order = [];
  for (const raw of ndjson.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.startsWith('{')) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const part = ev?.properties?.part || ev?.part;
    if (part && part.type === 'text' && typeof part.text === 'string') {
      const id = part.id || `anon-${order.length}`;
      if (!byId.has(id)) order.push(id);
      byId.set(id, part.text);
    } else if (ev?.type === 'text' && typeof ev.text === 'string') {
      const id = ev.id || `t-${order.length}`;
      if (!byId.has(id)) order.push(id);
      byId.set(id, ev.text);
    }
  }
  return order.map((id) => byId.get(id)).join('\n');
}

/** Pull the last balanced JSON object out of agent text. */
export function parseJsonFromText(text) {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/g;
  let m;
  let last = null;
  while ((m = fenced.exec(text))) {
    try {
      last = JSON.parse(m[1].trim());
    } catch {
      /* keep looking */
    }
  }
  if (last) return last;
  // Last balanced {...} in the text
  const end = text.lastIndexOf('}');
  for (let start = text.indexOf('{'); start !== -1 && start < end; start = text.indexOf('{', start + 1)) {
    try {
      const candidate = JSON.parse(text.slice(start, end + 1));
      if (candidate && typeof candidate === 'object') last = candidate;
    } catch {
      /* try next */
    }
  }
  return last;
}

/**
 * Spawn one check subagent.
 * @param {object} opts
 * @param {string} opts.agentId   agent name (e.g. "rg-docs-behavior")
 * @param {string} opts.reviewId
 * @param {string} opts.workDir   dedicated dir for evidence + summary.json
 * @param {string} opts.message   task message (references evidence files in workDir)
 * @param {string[]} [opts.files] extra files to attach
 * @returns {Promise<{ok, summary, stdoutText, raw, ms, error?}>}
 */
export function runCheckAgent({ agentId, reviewId, workDir, message, files = [] }) {
  const started = Date.now();
  fs.mkdirSync(workDir, { recursive: true });

  const args = [
    'run',
    '--agent', agentId,
    '--format', 'json',
    '--title', `releaseguard-${reviewId}-${agentId}`,
    '--dir', PROJECT_ROOT,
    // NOTE: the message MUST come before --file. `--file` is a yargs array
    // option and greedily consumes trailing positional args otherwise.
    message,
  ];
  for (const f of files) args.push('--file', f);
  if (process.env.RG_AGENT_VERBOSE) args.push('--print-logs', '--log-level', 'INFO');

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(resolveOpenCodeBin(), args, {
        cwd: PROJECT_ROOT,
        env: { ...process.env, RG_WORK_DIR: workDir },
        windowsHide: true,
        shell: false,
        // CRITICAL: `opencode run` reads stdin until EOF before starting.
        // node's default stdio leaves an OPEN pipe that never reaches EOF,
        // so the agent hangs silently right after `init` and always times
        // out. `ignore` gives it an immediate EOF (verified A/B/C).
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, summary: null, stdoutText: '', raw: '', ms: Date.now() - started, error: String(err) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill();
      } catch { /* already dead */ }
      // If the agent managed to write summary.json before we killed it,
      // the work is done — report success rather than falling back.
      const summary = readSummaryFile(workDir);
      writeAgentLog(workDir, { code: 'timeout', stdout, stderr, summary: !!summary });
      resolve({
        ok: !!summary,
        summary,
        stdoutText: extractAgentText(stdout),
        raw: stdout.slice(0, 4000),
        ms: Date.now() - started,
        error: summary ? undefined : `timeout after ${CHECK_TIMEOUT_MS}ms`,
      });
    }, CHECK_TIMEOUT_MS);

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000);
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000);
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      writeAgentLog(workDir, { code: 'spawn-error', stdout, stderr, summary: false });
      resolve({ ok: false, summary: null, stdoutText: '', raw: '', ms: Date.now() - started, error: String(err.message || err) });
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const fileSummary = readSummaryFile(workDir);
      const stdoutText = extractAgentText(stdout);
      const parsed = parseJsonFromText(stdoutText);
      const summary = fileSummary || parsed;
      const ok = code === 0 && !!summary;
      writeAgentLog(workDir, { code, stdout, stderr, summary: !!summary });
      resolve({
        ok,
        summary,
        stdoutText,
        raw: stdout.slice(-4000),
        ms: Date.now() - started,
        error: ok ? undefined : (summary ? `exit code ${code}` : `exit code ${code}; no summary (stderr: ${stderr.slice(-400)})`),
      });
    });
  });
}

function readSummaryFile(workDir) {
  try {
    const p = path.join(workDir, 'summary.json');
    const txt = fs.readFileSync(p, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/** Always persist the raw agent output — the only way to debug a dead check. */
function writeAgentLog(workDir, { code = null, stdout = '', stderr = '', summary = false }) {
  try {
    fs.writeFileSync(
      path.join(workDir, 'agent.log'),
      [
        `exit=${code} summary=${summary} at=${new Date().toISOString()}`,
        '--- stderr (tail 4k) ---',
        stderr.slice(-4000),
        '--- stdout (tail 8k) ---',
        stdout.slice(-8000),
      ].join('\n')
    );
  } catch { /* logging must never break a review */ }
}

export { PROJECT_ROOT };
