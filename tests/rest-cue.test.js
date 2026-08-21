// The rest cue — 21 Aug 2026.
//
// Del: "the design is slick and fucking cool, but not being notified when the alocated rest time is
// completed is annoying". On an iPhone the old beep could only ever be heard with the app open, the
// screen on and the logger visible, which is the one moment he doesn't need it — see the comment
// above swBuildCueWav() for the three independent reasons.
//
// The replacement stops trying to make a sound at the right moment and instead hands the OS a file
// that already knows when to arrive: N seconds of near-silence, then the tones. So the thing under
// test here is mostly *the bytes* — if the tone is at the wrong offset, or the header lies about the
// data length, the rest of the app can be perfect and he still gets nothing at 2:00.
//
// The other half is the cancel paths. A queued beep is a sound that has already left: nothing on the
// page can call it back except a pause(), so every route that ends or restarts a rest has to disarm.
// The failure that matters is a beep going off thirty seconds into the next set.
//
// Run: node tests/rest-cue.test.js

const fs = require('fs');
const path = require('path');
const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}`);
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('the rest cue — a scheduled sound, not a timed one');

const RATE = 8000;

class FakeBlob {
  constructor(parts, opts) { this.buf = Buffer.from(parts[0]); this.type = opts.type; }
}

const wav = load({
  functions: ['swBuildCueWav'],
  decls: ['SW_CUE_RATE', 'SW_CUE_MAX'],
  deps: { Blob: FakeBlob },
});

// Reads a blob back as a header summary + the raw samples.
function decode(blob) {
  const b = blob.buf;
  const dataBytes = b.readUInt32LE(40);
  return {
    riff: b.toString('ascii', 0, 4),
    wave: b.toString('ascii', 8, 12),
    data: b.toString('ascii', 36, 40),
    channels: b.readUInt16LE(22),
    rate: b.readUInt32LE(24),
    byteRate: b.readUInt32LE(28),
    blockAlign: b.readUInt16LE(32),
    bits: b.readUInt16LE(34),
    riffSize: b.readUInt32LE(4),
    dataBytes,
    totalBytes: b.length,
    pcm: new Int16Array(b.buffer, b.byteOffset + 44, dataBytes / 2),
  };
}

function peakBetween(pcm, fromSec, toSec) {
  let peak = 0;
  for (let i = Math.round(fromSec * RATE); i < Math.min(Math.round(toSec * RATE), pcm.length); i++) {
    peak = Math.max(peak, Math.abs(pcm[i]));
  }
  return peak;
}

// ── 1. it is a WAV a browser will actually accept ─────────────────────────
// Hand-rolled header, so every field is asserted. A wrong byteRate or blockAlign plays at the wrong
// speed instead of failing loudly, which would put the beep minutes away from where it belongs.
{
  const w = decode(wav.swBuildCueWav(120));
  eq(w.riff, 'RIFF', 'RIFF magic');
  eq(w.wave, 'WAVE', 'WAVE magic');
  eq(w.data, 'data', 'data chunk id');
  eq(w.channels, 1, 'mono');
  eq(w.rate, RATE, '8kHz — 880Hz needs 1760Hz, so this is generous and keeps the blob small');
  eq(w.bits, 16, '16-bit');
  eq(w.byteRate, RATE * 2, 'byte rate agrees with rate × channels × bytes-per-sample');
  eq(w.blockAlign, 2, 'block align agrees too');
  eq(w.dataBytes, w.totalBytes - 44, 'the data chunk size counts every byte after the 44-byte header');
  eq(w.riffSize, w.totalBytes - 8, 'and the RIFF size counts everything after its own field');
}

// ── 2. THE ASSERTION THIS FILE EXISTS FOR: the beep is where the rest ends ─
// Del sets 120s, he must hear it at 120s. The bed before it has to be inaudible and the tones after
// it unmistakable, so the two are asserted as a ratio rather than as absolutes.
{
  [60, 90, 120, 150, 180].forEach(secs => {
    const w = decode(wav.swBuildCueWav(secs));
    const bed = peakBetween(w.pcm, 0, secs);
    const tone = peakBetween(w.pcm, secs, secs + 0.4);

    ok(bed <= 2, `${secs}s: nothing audible before the target (bed peak ${bed} of 32767, about -84dBFS)`);
    ok(tone > 15000, `${secs}s: the tones are at full voice once it lands (peak ${tone})`);
    ok(tone / Math.max(bed, 1) > 1000, `${secs}s: the beep is thousands of times the bed, not a swell`);

    // Both tones, at swBeep()'s offsets — one beep sounds like a notification, two sound like D-LOG
    ok(peakBetween(w.pcm, secs, secs + 0.16) > 15000, `${secs}s: first tone at +0.00s`);
    ok(peakBetween(w.pcm, secs + 0.18, secs + 0.34) > 15000, `${secs}s: second tone at +0.18s`);
    ok(peakBetween(w.pcm, secs + 0.165, secs + 0.178) < 1000, `${secs}s: and a gap between them`);

    // The file has to outlast its own beep or the tail is clipped
    ok(w.pcm.length / RATE >= secs + 0.34, `${secs}s: the buffer runs past the end of the second tone`);
  });
}

// ── 2b. the bed is not digital zero, and that is deliberate ───────────────
// iOS tears down an audio session it decides is playing nothing at all, which would kill the beep
// that comes after it. A 50Hz tone at amplitude 2 is inaudible and keeps the session alive.
{
  const w = decode(wav.swBuildCueWav(60));
  let nonZero = 0;
  for (let i = 0; i < 60 * RATE; i++) if (w.pcm[i] !== 0) nonZero++;
  ok(nonZero > 60 * RATE * 0.3, 'the silent bed carries a real signal rather than digital zero');
  ok(peakBetween(w.pcm, 0, 60) <= 2, 'and it is inaudible while doing it');
}

// ── 3. the unlock frame must be SILENT ────────────────────────────────────
// swUnlockAudio() plays this inside the tap to buy the element its playback permission. If it carried
// the tones, tapping the watch would beep in his ear at 0:00 — the opposite of the whole feature.
{
  const w = decode(wav.swBuildCueWav(0.05, false));
  eq(peakBetween(w.pcm, 0, 1), 2, 'the unlock frame is bed-only — no tone anywhere in it');
  ok(w.totalBytes < 20000, `and it is tiny (${w.totalBytes} bytes), because it is played on the first tap`);
}

// ── 4. a silly rest time cannot allocate an absurd buffer ─────────────────
// The ✎ template editor takes free text, so "9999s" is reachable.
{
  const capped = decode(wav.swBuildCueWav(9999));
  const atCap = decode(wav.swBuildCueWav(600));
  eq(capped.totalBytes, atCap.totalBytes, 'anything past the cap builds the cap, not a 20-minute buffer');
  ok(capped.totalBytes < 11 * 1024 * 1024, `and the worst case stays sane (${(capped.totalBytes / 1048576).toFixed(1)}MB)`);
  ok(decode(wav.swBuildCueWav(120)).totalBytes < 2 * 1024 * 1024,
    'a real rest is under 2MB, which is what actually gets allocated in the gym');
}

// ── 5. arming and disarming ───────────────────────────────────────────────
const media = { played: 0, paused: 0, src: null, loaded: 0 };
const urls = { created: 0, revoked: 0, live: new Set(), sizes: {} };

const cue = load({
  functions: ['swArmCue', 'swDisarmCue', 'swBuildCueWav'],
  decls: ['SW_CUE_RATE', 'SW_CUE_MAX', 'swCueEl', 'swCueUrl', 'swCueArmed'],
  deps: {
    Blob: FakeBlob,
    URL: {
      createObjectURL: b => {
        const u = `blob:${++urls.created}`;
        urls.live.add(u);
        urls.sizes[u] = b.buf.length;
        return u;
      },
      revokeObjectURL: u => { urls.revoked++; urls.live.delete(u); },
    },
  },
  accessors: {
    state: '() => ({ armed: swCueArmed, url: swCueUrl })',
    attach: '(el) => { swCueEl = el; swCueUrl = null; swCueArmed = false; }',
  },
});

const EL = {
  play() { media.played++; return { then(f) { f(); return { catch() {} }; } }; },
  pause() { media.paused++; },
  set src(v) { media.src = v; },
  get src() { return media.src; },
  removeAttribute() { media.src = null; },
  load() { media.loaded++; },
};

function freshCue() {
  cue.attach(EL);
  media.played = 0; media.paused = 0; media.src = null; media.loaded = 0;
  urls.created = 0; urls.revoked = 0; urls.live.clear(); urls.sizes = {};
}

// 5a. the ordinary arm
{
  freshCue();
  cue.swArmCue(120, 0);
  eq(media.played, 1, 'arming plays the cue');
  eq(cue.state().armed, true, 'and records that it is armed, which is what gates the fallback beep');
  eq(urls.live.size, 1, 'exactly one object URL is live');
}

// 5b. THE ONE THAT MATTERS: re-arming never leaves two beeps queued
// swStart() overwrites a running timer for the same exercise without going through swStop(), so a
// re-tap lands straight here. Without the disarm the old cue keeps playing behind the new one and
// beeps at the ORIGINAL target — a sound with no cause, mid-set.
{
  freshCue();
  cue.swArmCue(120, 0);
  const firstUrl = cue.state().url;
  cue.swArmCue(90, 0);
  // 2, not 1: swArmCue() disarms unconditionally, so the FIRST arm pauses an idle element too.
  // That is deliberate — the disarm must not have to trust a flag about what is currently playing.
  eq(media.paused, 2, 're-arming pauses the cue that was already playing');
  ok(!urls.live.has(firstUrl), 'and revokes its blob rather than leaking it');
  eq(urls.live.size, 1, 'leaving exactly one queued beep, not two');
  ok(cue.state().url !== firstUrl, 'the armed URL is the new one');
}

// 5c. disarm is total
{
  freshCue();
  cue.swArmCue(180, 0);
  cue.swDisarmCue();
  eq(cue.state().armed, false, 'disarmed');
  eq(cue.state().url, null, 'the URL reference is dropped');
  eq(urls.live.size, 0, 'the blob is revoked — a rest per set, an hour a session, it has to not leak');
  eq(media.src, null, 'and the element is emptied so it cannot resume');
  eq(media.paused, 2, 'paused — once by the leading disarm inside swArmCue, once by this explicit one');
}

// 5d. nothing left to announce
// swHandOverWatch() can move a running timer onto an exercise with a SHORTER rest, where the target
// is already behind us. Queuing a cue there would beep immediately, for no reason.
{
  freshCue();
  cue.swArmCue(60, 90);
  eq(media.played, 0, 'already past the target: no cue is armed');
  eq(cue.state().armed, false, 'and it says so');
  cue.swArmCue(60, 59.8);
  eq(media.played, 0, 'nor for the last fraction of a second, which would land after he has started');
}

// 5e. armed for the time REMAINING, not the whole rest
// The hand-over case: 60s already served of a 180s rest must queue 120s of silence, not 180s.
{
  freshCue();
  cue.swArmCue(180, 60);
  eq(media.played, 1, 'a rest 60s into its 180s still arms');
  const armedSize = urls.sizes[cue.state().url];
  eq(armedSize, wav.swBuildCueWav(120).buf.length, 'and the blob is the 120s one — the time remaining');
  ok(armedSize !== wav.swBuildCueWav(180).buf.length, 'not the 180s one, which would beep a minute late');
}

// 5f. no element yet (before any tap has created it) must not throw
{
  cue.attach(null);
  cue.swArmCue(120, 0);
  eq(cue.state().armed, false, 'no element, no cue, no exception');
}

// ── 6. every path that ends a rest disarms it ─────────────────────────────
// Read off the real source rather than re-implemented, because the failure here is an OMISSION — a
// new exit path added later that forgets to cancel. Only the source can catch that.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const bodyOf = name => {
    const i = src.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
    return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i));
  };

  ok(bodyOf('swStop').includes('swDisarmCue()'),
    'swStop disarms — stopping the watch must cancel the beep');
  ok(bodyOf('swReset').includes('swDisarmCue()'),
    'swReset disarms — a long-press wipe must cancel the beep');
  ok(bodyOf('swStart').includes('swArmCue('),
    'swStart arms the cue at the start of the rest, not at the crossing');
  ok(bodyOf('swHandOverWatch').includes('swArmCue('),
    're-armed on hand-over, where the target changes under a running timer');
  ok(bodyOf('swUnlockAudio').includes('swCueEl'),
    'the element is unlocked in the gesture — iOS grants playback permission per element');
  ok(bodyOf('swUnlockAudio').includes('swBuildCueWav(0.05, false)'),
    'and with the silent frame, not one carrying the tones');

  // The fallback. swRenderWatch's beep is now the backstop for the cases the cue cannot cover
  // (a desktop autoplay refusal, a rest restored across navigation outside a gesture). Firing it
  // while the cue is armed would double every beep.
  ok(/if \(pct >= 1 && !swCompletionBeeped && !swCueArmed\)/.test(src),
    'the render-tick beep stands down whenever the cue is armed');

  // swRestoreFromStorage runs on SPA navigation and is NOT a gesture, so it must not try to arm.
  ok(!bodyOf('swRestoreFromStorage').includes('swArmCue('),
    'restoring across navigation does not re-arm — not a gesture, and the cue is already playing');
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
