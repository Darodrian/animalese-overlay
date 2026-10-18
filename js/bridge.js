// Version fija de CDN: la sala usa Supabase Realtime (broadcast, self:false).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const SUPA_MODULE = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

function configured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

// ---- sala realtime (dashboard <-> overlay) ----
export function createBridge(room) {
  const handlers = { status: [], hello: [], state: [], set: [], say: [] };
  let channel = null;
  let client = null;
  let subscribed = false;

  async function getClient() {
    if (!configured()) throw new Error('Falta configuracion de Supabase');
    if (!client) {
      const mod = await import(SUPA_MODULE);
      client = mod.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    return client;
  }

  function listen(event, fn) {
    channel.on('broadcast', { event }, (msg) => fn((msg && msg.payload) || {}));
  }

  async function connect() {
    const c = await getClient();
    channel = c.channel(room, { config: { broadcast: { self: false } } });
    listen('hello', (p) => handlers.hello.forEach((h) => h(p)));
    listen('state', (p) => handlers.state.forEach((h) => h(p)));
    listen('set', (p) => handlers.set.forEach((h) => h(p)));
    listen('say', (p) => handlers.say.forEach((h) => h(p)));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };
      const timer = setTimeout(() => finish(reject, new Error('TIMED_OUT')), 15000);
      channel.subscribe((status) => {
        handlers.status.forEach((h) => h(status));
        if (status === 'SUBSCRIBED') {
          subscribed = true;
          finish(resolve);
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          subscribed = false;
          finish(reject, new Error(status));
        }
      });
    });
  }

  function send(event, payload) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event, payload });
  }

  return {
    connect,
    async leave() {
      if (channel && client) await client.removeChannel(channel);
      channel = null;
      subscribed = false;
    },
    isConnected: () => subscribed,
    sendHello(payload) {
      send('hello', payload);
    },
    sendState(payload) {
      send('state', payload);
    },
    sendSet(payload) {
      send('set', payload);
    },
    sendSay(payload) {
      send('say', payload);
    },
    onStatus(fn) {
      handlers.status.push(fn);
    },
    onHello(fn) {
      handlers.hello.push(fn);
    },
    onState(fn) {
      handlers.state.push(fn);
    },
    onSet(fn) {
      handlers.set.push(fn);
    },
    onSay(fn) {
      handlers.say.push(fn);
    },
  };
}
