// Shared configuration for dashboard and overlay.
// Supabase project shared with cartas-cotemon and miguelium-wisdom;
// the publishable key is client-side by design (rooms are keyed by unguessable keys).
export const SUPABASE_URL = 'https://liuhcwkpuivcletiwpab.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_YenbmLGW94t6XHVXgZx0DQ_e2XjL6tC';

export const CHANNEL_STORE = 'ac_channel';
export const PREVIEW_MUTE_STORE = 'ac_preview_muted';

const norm = (v) => String(v ?? '').trim().toLowerCase();

export const keyStore = (channel) => `ac_key_${norm(channel)}`;
export const cfgStore = (channel) => `ac_cfg_${norm(channel)}`;
export const liveCfgStore = (channel) => `ac_livecfg_${norm(channel)}`;

export const DEFAULT_SETTINGS = {
  prefix: 'ac',
  permissions: {
    everyone: true,
    broadcaster: true,
    mod: true,
    vip: true,
    subscriber: true,
  },
  userCooldownMs: 30_000,
  minGapMs: 1_200,
  maxLength: 120,
  requirePortrait: true,
};
