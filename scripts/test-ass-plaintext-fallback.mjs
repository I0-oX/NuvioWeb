// Focused regression tests: plain-text subtitle pipelines (VTT/HTML/native
// fallback) must never project ASS internals as cue text, and must never
// drop legitimate dialogue to achieve it.
// Run: node ./scripts/test-ass-plaintext-fallback.mjs
//
// Covered units:
// - js/core/player/assSubtitle.js (external-file VTT fallback)
// - services/webos/src/bitmapSubtitles.js (embedded VTT window body and ASS
//   body event filtering; well-formed payloads pass through untouched).
//
// Design rules under test (no Text-position guessing anywhere):
// - Only closed drawing sections with strict bare `{\p0}` closers (or
//   unclosed ones running to the event end) are removed; `{\p1\p0}Hello`
//   keeps Hello, chained drawings resolve to the final text.
// - Only provable tag residue (backslash + unbalanced braces + ASS command
//   marker) is dropped; everything else passes through.
// Deliberate non-goals: short-header Text recovery, bare digit-suffixed
// commands without parens/ampersands in balanced text.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { convertAssDialogueToVttCues } = await import(
  path.join(rootDir, "js/core/player/assSubtitle.js")
);
const service = require(path.join(rootDir, "services/webos/src/bitmapSubtitles.js"))._test;

let failures = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) {
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

function vttCueTexts(body) {
  return convertAssDialogueToVttCues(body).map((cue) => cue.text);
}

function assBody(textLines) {
  return [
    "[Script Info]",
    "Title: t",
    "[V4+ Styles]",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...textLines.map(
      (text, index) =>
        `Dialogue: 0,0:00:${String(10 + index).padStart(2, "0")}.00,0:00:${String(11 + index).padStart(2, "0")}.00,Default,,0,0,0,,${text}`
    )
  ].join("\n");
}

// --- Drawings carry no dialogue, adjacent dialogue survives. ---
check(
  "drawing-only event yields no cue",
  JSON.stringify(vttCueTexts(assBody(["{\\p1}m 64.89 68.77 l 64.17 67.11 l 63.09 66.4{\\p0}"]))),
  JSON.stringify([])
);

check(
  "open-close in one block keeps following dialogue",
  JSON.stringify(vttCueTexts(assBody(["{\\p1\\p0}Hello"]))),
  JSON.stringify(["Hello"])
);

check(
  "chained drawings resolve to final dialogue",
  JSON.stringify(vttCueTexts(assBody(["{\\p1}m 0 0 l 1 1{\\p0\\p1}m 2 2 l 3 3{\\p0}Hello"]))),
  JSON.stringify(["Hello"])
);

check(
  "dialogue before unclosed drawing is preserved",
  JSON.stringify(vttCueTexts(assBody(["Sign {\\p1}m 0 0 l 10 10"]))),
  JSON.stringify(["Sign"])
);

// --- Provable tag residue is suppressed, never projected. ---
check(
  "mid-tag fragment yields no cue",
  JSON.stringify(
    vttCueTexts(assBody(["320,820,640)\\frz358.4\\org(1889.15,82.92)\\c&H1B1516&}Menacing"]))
  ),
  JSON.stringify([])
);

check(
  "photo fragment without braces but with command yields no cue",
  JSON.stringify(vttCueTexts(assBody(["11.12,955.26,-783.88)\\fsp0.0"]))),
  JSON.stringify([])
);

// --- Legitimate text is never dropped. ---
check(
  "positioned dialogue is preserved",
  JSON.stringify(vttCueTexts(assBody(["{\\an8\\pos(1011.12,955.26)\\fsp0}The Culling Game"]))),
  JSON.stringify(["The Culling Game"])
);

check(
  "windows path with stray brace is preserved",
  JSON.stringify(vttCueTexts(assBody(["Path C:\\temp} ready"]))),
  JSON.stringify(["Path C:\\temp} ready"])
);

check(
  "backslash prose with brace is preserved",
  JSON.stringify(vttCueTexts(assBody(["a\\b}c"]))),
  JSON.stringify(["a\\b}c"])
);

check(
  "bare positioning command is preserved literally",
  JSON.stringify(vttCueTexts(assBody(["\\pos(10,20)"]))),
  JSON.stringify(["\\pos(10,20)"])
);

check(
  "backslash path with digits is preserved",
  JSON.stringify(vttCueTexts(assBody(["C:\\fs2"]))),
  JSON.stringify(["C:\\fs2"])
);

check(
  "backslash path with parens is preserved",
  JSON.stringify(vttCueTexts(assBody(["C:\\path (x86)\\app"]))),
  JSON.stringify(["C:\\path (x86)\\app"])
);

check(
  "plain dialogue untouched",
  JSON.stringify(vttCueTexts(assBody(["Just text", "1, 2, 3, 4, 5, 6"]))),
  JSON.stringify(["Just text", "1, 2, 3, 4, 5, 6"])
);

check(
  "truncated tail block is cut, head preserved",
  JSON.stringify(vttCueTexts(assBody(["Tail {\\fad(200,200"]))),
  JSON.stringify(["Tail"])
);

// --- Service VTT window: same guarantees end to end. ---
const track = { codecId: "S_TEXT/ASS" };
const toPayload = (line) => Buffer.from(line, "utf8");
const drawingLine =
  "Dialogue: 0,0:00:15.00,0:00:17.00,Default,,0,0,0,,{\\p1}m 64.89 68.77 l 64.17 67.11{\\p0}";
const fragmentLine =
  "Dialogue: 0,0:00:12.00,0:00:14.00,Default,,0,0,0,,320,820,640)\\frz358.4\\org(1889.15,82.92)\\c&H1B1516&}Menacing";
const taggedLine =
  "Dialogue: 0,0:00:13.00,0:00:14.00,Default,,0,0,0,,{\\an8\\pos(1011.12,955.26)}Placed";
const normalLine = "Dialogue: 0,0:00:18.00,0:00:20.00,Default,,0,0,0,,Normal line";
const pathLine = "Dialogue: 0,0:00:21.00,0:00:23.00,Default,,0,0,0,,Path C:\\temp} ready";
const tailLine = "Dialogue: 0,0:00:22.00,0:00:24.00,Default,,0,0,0,,Tail {\\fad(200,200";
const window = service.buildTextSubtitleWindowPayload(
  track,
  [
    { payload: toPayload(drawingLine), timestampMs: 15000, durationMs: 2000 },
    { payload: toPayload(fragmentLine), timestampMs: 12000, durationMs: 2000 },
    { payload: toPayload(taggedLine), timestampMs: 13000, durationMs: 1000 },
    { payload: toPayload(normalLine), timestampMs: 18000, durationMs: 2000 },
    { payload: toPayload(pathLine), timestampMs: 21000, durationMs: 2000 },
    { payload: toPayload(tailLine), timestampMs: 22000, durationMs: 2000 }
  ],
  0,
  60000,
  { includeAssBody: true }
);

check("VTT body has no drawing coordinates", window.body.includes("64.89"), false);
check("VTT body has no tag fragment", window.body.includes("frz358"), false);
check("VTT body keeps readable cue", window.body.includes("Normal line"), true);
check("VTT body keeps placed cue text", window.body.includes("Placed"), true);
check("VTT body has no override braces", window.body.includes("{\\an8"), false);
check("VTT body keeps windows path", window.body.includes("Path C:\\temp} ready"), true);
check("VTT body cuts truncated tail, keeps head", window.body.includes("Tail"), true);
check("VTT body has no tail residue", window.body.includes("fad(200,200"), false);
check(
  "ASS body keeps drawing payload for ass.js",
  window.assBody.includes("{\\p1}m 64.89 68.77 l 64.17 67.11{\\p0}"),
  true
);
check("ASS body drops fragment event", window.assBody.includes("frz358"), false);
check(
  "ASS body keeps tagged event intact",
  window.assBody.includes("{\\an8\\pos(1011.12,955.26)}Placed"),
  true
);
check("ASS body keeps windows path event", window.assBody.includes("Path C:\\temp} ready"), true);

if (failures > 0) {
  console.error(`${failures} failing case(s)`);
  process.exit(1);
}
console.log("All ASS plain-text fallback cases pass.");
