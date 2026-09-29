const RANGES = {
  pitch: [1.0, 2.0],
  speed: [3.3, 4.5],
  randomness: [0.05, 0.15],
  melodyRate: [0.03, 0.08],
  melodyAmplitude: [0.05, 0.15],
  spaceDelay: [0.02, 0.05],
  punctuationDelay: [0.2, 0.4],
};

const MIN_KEPT = 0.3;

const DEFAULT_PUNCTUATIONS = [
  '.', ',', '!', '?', "'", '"', '(', ')', '~',
  '。', '、', '！', '？', 'っ', 'ッ', 'ー',
];

const PITCH_FLOOR = 0.05;
const PITCH_CEIL = 4;

const SPEED_FLOOR = 0.1;
const SPEED_CEIL = 6;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n) => Math.round(n * 1000) / 1000;
const draw = ([lo, hi]) => (lo === hi ? lo : lo + Math.random() * (hi - lo));

export { DEFAULT_PUNCTUATIONS };

const SAFE = {
  pitch: RANGES.pitch.map((n) => clamp(n, PITCH_FLOOR, PITCH_CEIL)),
  speed: RANGES.speed.map((n) => clamp(n, SPEED_FLOOR, SPEED_CEIL)),
  randomness: RANGES.randomness.map((n) => clamp(n, 0, 1)),
  melodyRate: RANGES.melodyRate.map((n) => clamp(n, 0, 1)),
  melodyAmplitude: RANGES.melodyAmplitude.map((n) => clamp(n, 0, 1)),
  spaceDelay: RANGES.spaceDelay.map((n) => clamp(n, 0, 5)),
  punctuationDelay: RANGES.punctuationDelay.map((n) => clamp(n, 0, 10)),
};

export function drawVoice() {
  let pitch = draw(SAFE.pitch);
  let speed = draw(SAFE.speed);

  if (pitch / speed < MIN_KEPT) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const p = draw(SAFE.pitch);
      const s = draw(SAFE.speed);
      if (p / s >= MIN_KEPT) {
        pitch = p;
        speed = s;
        break;
      }
    }
    if (pitch / speed < MIN_KEPT) {
      pitch = 1.5;
      speed = 4;
    }
  }

  return {
    pitch: round(pitch),
    speed: round(speed),
    randomness: round(draw(SAFE.randomness)),
    melodyRate: round(draw(SAFE.melodyRate)),
    melodyAmplitude: round(draw(SAFE.melodyAmplitude)),
    spaceDelay: round(draw(SAFE.spaceDelay)),
    punctuationDelay: round(draw(SAFE.punctuationDelay)),
    punctuations: DEFAULT_PUNCTUATIONS,
  };
}
