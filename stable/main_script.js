// ===== Web Audio setup =====
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx = new AudioCtx();
let source = null; // MediaElementSource

const audio = document.getElementById("audio");
const scope = document.getElementById("scope");
const c = scope.getContext("2d");

const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const seek = document.getElementById("seek");
const cur = document.getElementById("cur");
const dur = document.getElementById("dur");
const titleEl = document.getElementById("title");
const bypassBtn = document.getElementById("bypass");

const presetSel = document.getElementById("preset");
const preamp = document.getElementById("preamp");
const resetBtn = document.getElementById("reset");

const compEnable = document.getElementById("comp-enable");
const compThr = document.getElementById("comp-thr");
const compRatio = document.getElementById("comp-ratio");
const compAttack = document.getElementById("comp-attack");
const compRelease = document.getElementById("comp-release");

const revEnable = document.getElementById("reverb-enable");
const revMix = document.getElementById("reverb-mix");
const revDecay = document.getElementById("reverb-decay");

const bassEnable = document.getElementById("bass-enable");
const bassGain = document.getElementById("bass-gain");
const presence = document.getElementById("presence");

const bypass2 = document.getElementById("bypass2");
const balance = document.getElementById("balance");
const trim = document.getElementById("trim");

const savePresetBtn = document.getElementById("savePreset");
const loadPresetBtn = document.getElementById("loadPreset");
const presetFile = document.getElementById("presetFile");

// Node graph: media -> preGain -> [10x EQ] -> bass shelf(optional) -> presence peaking -> dynamics -> reverb mix -> balance -> analyser -> out
const preGain = ctx.createGain();
const eqBands = [];
const eqFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const eqMin = -12,
  eqMax = 12;

// Create 10 peaking filters
for (let i = 0; i < eqFrequencies.length; i++) {
  const f = ctx.createBiquadFilter();
  f.type = "peaking";
  f.frequency.value = eqFrequencies[i];
  f.Q.value = 1.0; // moderate bandwidth
  f.gain.value = 0;
  eqBands.push(f);
}

// Optional shelves / presence
const bassShelf = ctx.createBiquadFilter();
bassShelf.type = "lowshelf";
bassShelf.frequency.value = 100;
bassShelf.gain.value = 0;

const presencePeak = ctx.createBiquadFilter();
presencePeak.type = "peaking";
presencePeak.frequency.value = 4000;
presencePeak.Q.value = 1.0;
presencePeak.gain.value = 0;

// Compressor
const comp = ctx.createDynamicsCompressor();
comp.threshold.value = -24;
comp.ratio.value = 4;
comp.attack.value = 0.003;
comp.release.value = 0.25;

// Reverb via generated impulse (simple exponential decay noise)
const convolver = ctx.createConvolver();
const reverbGain = ctx.createGain();
const dryGain = ctx.createGain();
reverbGain.gain.value = 0.0; // mix control
dryGain.gain.value = 1.0;

function buildImpulse(decaySec = 2.5) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(decaySec * rate));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3); // quick-ish decay
    }
  }
  convolver.buffer = impulse;
}
buildImpulse();

// Stereo balance
const splitter = ctx.createChannelSplitter(2);
const merger = ctx.createChannelMerger(2);
const leftGain = ctx.createGain();
const rightGain = ctx.createGain();
leftGain.gain.value = 1;
rightGain.gain.value = 1;

// Output stage
const trimGain = ctx.createGain();
trimGain.gain.value = 1.0;

// Visualizer
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048;
const timeData = new Uint8Array(analyser.fftSize);

// Connect the static graph (everything except the media source)
function connectGraph() {
  // Start chain
  preGain.disconnect();
  preGain.connect(eqBands[0]);
  for (let i = 0; i < eqBands.length - 1; i++)
    eqBands[i].connect(eqBands[i + 1]);

  eqBands[eqBands.length - 1].connect(bassShelf);
  bassShelf.connect(presencePeak);

  // Dry / wet branches for reverb
  presencePeak.connect(dryGain);
  presencePeak.connect(convolver);
  convolver.connect(reverbGain);

  // Sum dry + wet into splitter for balance
  const sumNode = ctx.createGain();
  dryGain.connect(sumNode);
  reverbGain.connect(sumNode);

  sumNode.connect(splitter);
  splitter.connect(leftGain, 0);
  splitter.connect(rightGain, 1);
  leftGain.connect(merger, 0, 0);
  rightGain.connect(merger, 0, 1);

  // Dynamics compressor can sit before visualizer to show post-effects signal
  merger.connect(comp);
  comp.connect(trimGain);
  trimGain.connect(analyser);
  analyser.connect(ctx.destination);
}
connectGraph();

// ===== UI: EQ bands =====
const eqContainer = document.getElementById("eq");
const bandControls = [];
eqFrequencies.forEach((freq, idx) => {
  const wrap = document.createElement("div");
  wrap.className = "eqband";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = eqMin;
  slider.max = eqMax;
  slider.step = 0.1;
  slider.value = 0;
  slider.setAttribute("aria-label", `${freq} Hz`);

  const label = document.createElement("label");
  label.textContent = freq >= 1000 ? freq / 1000 + "k" : freq;

  slider.addEventListener("input", () => {
    eqBands[idx].gain.value = parseFloat(slider.value);
  });

  wrap.appendChild(slider);
  wrap.appendChild(label);
  eqContainer.appendChild(wrap);
  bandControls.push(slider);
});

// ===== File loading =====
function loadFile(file) {
  const url = URL.createObjectURL(file);
  audio.src = url;
  audio.load();
  titleEl.textContent = file.name || "Unknown Title";
  playBtn.disabled = false;
  pauseBtn.disabled = false;
  if (!source) {
    source = ctx.createMediaElementSource(audio);
    source.connect(preGain);
  }
}

document.getElementById("file").addEventListener("change", (e) => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});

// Drag & drop
window.addEventListener("dragover", (e) => {
  e.preventDefault();
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

// ===== Transport & time =====
playBtn.addEventListener("click", async () => {
  await ctx.resume();
  audio.play();
});
pauseBtn.addEventListener("click", () => audio.pause());

audio.addEventListener("timeupdate", () => {
  if (audio.duration) {
    seek.max = audio.duration;
    seek.value = audio.currentTime;
    cur.textContent = fmt(audio.currentTime);
    dur.textContent = fmt(audio.duration);
  }
});
seek.addEventListener("input", () => {
  audio.currentTime = seek.value;
});

function fmt(sec) {
  sec = Math.floor(sec || 0);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}

// ===== Bypass & reset =====
let bypassed = false;
function setBypass(state) {
  bypassed = state;
  if (!source) return;
  if (bypassed) {
    try {
      source.disconnect();
    } catch {}
    source.connect(ctx.destination);
    bypassBtn.textContent = "Bypassed";
  } else {
    try {
      source.disconnect();
    } catch {}
    source.connect(preGain);
    bypassBtn.textContent = "Bypass";
  }
}
bypassBtn.addEventListener("click", () => setBypass(!bypassed));
document
  .getElementById("bypass2")
  .addEventListener("change", (e) => setBypass(e.target.checked));

function resetAll() {
  bandControls.forEach((s, i) => {
    s.value = 0;
    eqBands[i].gain.value = 0;
  });
  preamp.value = 0;
  preGain.gain.value = dbToGain(0);
  trim.value = 0;
  trimGain.gain.value = dbToGain(0);
  bassEnable.checked = false;
  bassShelf.gain.value = 0;
  bassGain.value = 6;
  presence.value = 0;
  presencePeak.gain.value = 0;
  compEnable.checked = true;
  comp.threshold.value = -24;
  compThr.value = -24;
  comp.ratio.value = 4;
  compRatio.value = 4;
  comp.attack.value = 0.003;
  compAttack.value = 0.003;
  comp.release.value = 0.25;
  compRelease.value = 0.25;
  revEnable.checked = false;
  reverbGain.gain.value = 0;
  revMix.value = 0.2;
  revDecay.value = 2.5;
  buildImpulse(2.5);
  balance.value = 0;
  updateBalance(0);
  presetSel.value = "flat";
}
resetBtn.addEventListener("click", resetAll);

// ===== Knobs wiring =====
preamp.addEventListener(
  "input",
  () => (preGain.gain.value = dbToGain(parseFloat(preamp.value)))
);
trim.addEventListener(
  "input",
  () => (trimGain.gain.value = dbToGain(parseFloat(trim.value)))
);

compEnable.addEventListener("change", () => {
  if (compEnable.checked) {
    merger.disconnect();
    merger.connect(comp);
  } else {
    try {
      merger.disconnect();
    } catch {}
    merger.connect(trimGain);
  }
});
compThr.addEventListener(
  "input",
  () => (comp.threshold.value = parseFloat(compThr.value))
);
compRatio.addEventListener(
  "input",
  () => (comp.ratio.value = parseFloat(compRatio.value))
);
compAttack.addEventListener(
  "input",
  () => (comp.attack.value = parseFloat(compAttack.value))
);
compRelease.addEventListener(
  "input",
  () => (comp.release.value = parseFloat(compRelease.value))
);

revEnable.addEventListener("change", () => {
  reverbGain.gain.value = revEnable.checked ? parseFloat(revMix.value) : 0;
});
revMix.addEventListener("input", () => {
  if (revEnable.checked) reverbGain.gain.value = parseFloat(revMix.value);
});
revDecay.addEventListener("input", () =>
  buildImpulse(parseFloat(revDecay.value))
);

bassEnable.addEventListener(
  "change",
  () =>
    (bassShelf.gain.value = bassEnable.checked ? parseFloat(bassGain.value) : 0)
);
bassGain.addEventListener("input", () => {
  if (bassEnable.checked) bassShelf.gain.value = parseFloat(bassGain.value);
});
presence.addEventListener(
  "input",
  () => (presencePeak.gain.value = parseFloat(presence.value))
);

balance.addEventListener("input", () =>
  updateBalance(parseFloat(balance.value))
);
function updateBalance(val) {
  // val -1 = left only, 0 = center, 1 = right only
  const L = clamp(1 - Math.max(0, val), 0, 1);
  const R = clamp(1 + Math.min(0, val), 0, 1);
  leftGain.gain.value = L;
  rightGain.gain.value = R;
}

// ===== Presets =====
const presets = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, -1, -1, 0, 1, 1],
  treble: [-2, -2, -1, 0, 0, 1, 2, 3, 4, 5],
  vshape: [4, 3, 2, 1, 0, 0, 0, 1, 3, 4],
  vocal: [-3, -2, -1, 1, 2, 3, 4, 2, 0, -1],
  loudness: [4, 3, 1, 0, 0, 0, 1, 2, 3, 4],
};
function applyPreset(key) {
  const arr = presets[key] || presets.flat;
  arr.forEach((g, i) => {
    bandControls[i].value = g;
    eqBands[i].gain.value = g;
  });
}
presetSel.addEventListener("change", () => applyPreset(presetSel.value));

savePresetBtn.addEventListener("click", () => {
  const gains = bandControls.map((s) => parseFloat(s.value));
  const data = {
    eq: gains,
    preamp: parseFloat(preamp.value),
    trim: parseFloat(trim.value),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "eq-preset.json";
  a.click();
});
loadPresetBtn.addEventListener("click", () => presetFile.click());
presetFile.addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const txt = await f.text();
  try {
    const json = JSON.parse(txt);
    if (Array.isArray(json.eq) && json.eq.length === 10) {
      json.eq.forEach((g, i) => {
        bandControls[i].value = g;
        eqBands[i].gain.value = g;
      });
    }
    if (typeof json.preamp === "number") {
      preamp.value = json.preamp;
      preGain.gain.value = dbToGain(json.preamp);
    }
    if (typeof json.trim === "number") {
      trim.value = json.trim;
      trimGain.gain.value = dbToGain(json.trim);
    }
  } catch (err) {
    alert("Invalid preset file");
  }
});

// ===== Visualizer render loop =====
function draw() {
  requestAnimationFrame(draw);
  const w = scope.clientWidth,
    h = scope.clientHeight;
  if (scope.width !== w) scope.width = w;
  if (scope.height !== h) scope.height = h;

  c.clearRect(0, 0, w, h);
  analyser.getByteTimeDomainData(timeData);

  // waveform
  c.globalAlpha = 0.9;
  c.lineWidth = 2;
  c.beginPath();
  for (let i = 0; i < timeData.length; i++) {
    const x = (i / (timeData.length - 1)) * w;
    const y = (timeData[i] / 255) * h;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.strokeStyle = "#8ec9ff";
  c.stroke();

  // glow overlay
  const grad = c.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(110, 170, 255, .25)");
  grad.addColorStop(1, "rgba(110, 170, 255, 0)");
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);
}
draw();

// ===== Helpers & hotkeys =====
function dbToGain(db) {
  return Math.pow(10, db / 20);
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    audio.paused ? audio.play() : audio.pause();
  }
  if (e.key.toLowerCase() === "b") setBypass(!bypassed);
  if (e.key.toLowerCase() === "r") resetAll();
});

// Initialize defaults
resetAll();
