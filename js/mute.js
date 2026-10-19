// Shared mute flag between the overlay boot (URL fragment) and the
// dashboard's live toggle (postMessage). Playback consults it; visuals keep running.
let muted = false;

export function setMuted(v) {
  muted = Boolean(v);
}

export function isMuted() {
  return muted;
}
