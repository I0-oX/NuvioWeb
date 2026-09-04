// Focused regression tests: ASS vector drawings must never surface as
// readable cue text in plain-text pipelines (VTT/HTML/native fallback).
// Run: node ./scripts/test-ass-drawing-fallback.mjs
// A drawing section carries no dialogue by ASS semantics (ass.js renders it
// as a vector shape with empty text, and text after an unclosed \p block is
// drawing data up to the event end), so suppressing it cannot truncate
// legitimate dialogue. Covered units:
// - js/core/player/assSubtitle.js (external-file VTT fallback)
// - services/webos/src/bitmapSubtitles.js (embedded VTT window body; the ASS
//   body must keep the original payload so ass.js still draws the shapes).

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

// --- App converter: drawing-only cues produce no cue. ---
check(
  "drawing-only event yields no cue",
  JSON.stringify(vttCueTexts(assBody(["{\\p1}m 64.89 68.77 l 64.17 67.11 l 63.09 66.4{\\p0}"]))),
  JSON.stringify([])
);

// --- App converter: dialogue adjacent to drawings is preserved. ---
check(
  "dialogue after closed drawing is preserved",
  JSON.stringify(vttCueTexts(assBody(["{\\p1}m 0 0 l 10 10{\\p0}Hello World"]))),
  JSON.stringify(["Hello World"])
);

check(
  "dialogue before unclosed drawing is preserved",
  JSON.stringify(vttCueTexts(assBody(["Sign {\\p1}m 0 0 l 10 10"]))),
  JSON.stringify(["Sign"])
);

// --- App converter: non-drawing overrides keep historical behavior. ---
check(
  "positioned dialogue is preserved",
  JSON.stringify(vttCueTexts(assBody(["{\\an8\\pos(1011.12,955.26)\\fsp0}The Culling Game"]))),
  JSON.stringify(["The Culling Game"])
);

check(
  "pbo/fsp0 tags are not drawings",
  JSON.stringify(vttCueTexts(assBody(["{\\pbo-50}Lifted", "{\\an8\\fsp0}Wide"]))),
  JSON.stringify(["Lifted", "Wide"])
);

check(
  "plain dialogue untouched",
  JSON.stringify(vttCueTexts(assBody(["Just text", "1, 2, 3, 4, 5, 6"]))),
  JSON.stringify(["Just text", "1, 2, 3, 4, 5, 6"])
);

// --- Service VTT window: drawings absent from readable text, kept for ass.js. ---
const track = { codecId: "S_TEXT/ASS" };
const toPayload = (line) => Buffer.from(line, "utf8");
const drawingLine =
  "Dialogue: 0,0:00:15.00,0:00:17.00,Default,,0,0,0,,{\\p1}m 64.89 68.77 l 64.17 67.11{\\p0}";
const normalLine = "Dialogue: 0,0:00:18.00,0:00:20.00,Default,,0,0,0,,Normal line";
const window = service.buildTextSubtitleWindowPayload(
  track,
  [
    { payload: toPayload(drawingLine), timestampMs: 15000, durationMs: 2000 },
    { payload: toPayload(normalLine), timestampMs: 18000, durationMs: 2000 }
  ],
  0,
  60000,
  { includeAssBody: true }
);

check("VTT body has no drawing coordinates", window.body.includes("64.89"), false);
check("VTT body keeps readable cue", window.body.includes("Normal line"), true);
check(
  "ASS body keeps drawing payload for ass.js",
  window.assBody.includes("{\\p1}m 64.89 68.77 l 64.17 67.11{\\p0}"),
  true
);

if (failures > 0) {
  console.error(`${failures} failing case(s)`);
  process.exit(1);
}
console.log("All ASS drawing fallback cases pass.");
