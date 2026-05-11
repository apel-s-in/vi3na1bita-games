// UID.001_(Playback safety invariant)_(game-app не управляет музыкой)_(нет audio/WebAudio/playback commands)
// UID.006_(Lazy isolated micro-app)_(работает внутри iframe или standalone preview)_(основной app загружает его по клику)
// UID.082_(Local truth vs external telemetry split)_(получаем только safe snapshot)_(не читаем localStorage/IndexedDB/token)
// UID.094_(No-paralysis rule)_(ошибка Game Center не ломает основное приложение)_(только postMessage + fixed 9:16 image menu)

const $ = id => document.getElementById(id);

const state = {
  bridgeId: '',
  snapshot: null
};

const send = (type, payload = {}) => {
  if (!state.bridgeId || !window.parent || window.parent === window) return false;
  try {
    window.parent.postMessage({ kind: 'vitrina:game', bridgeId: state.bridgeId, type, payload }, '*');
    return true;
  } catch {
    return false;
  }
};

const showToast = text => {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 1300);
};

const applySnapshot = snapshot => {
  state.snapshot = snapshot || state.snapshot || {};
};

const setBridgeLabel = text => {
  const el = $('bridge-pill');
  if (el) el.textContent = text;
};

const fitWorld = () => {
  const scene = $('scene');
  const world = $('world');
  if (!scene || !world) return;

  const r = scene.getBoundingClientRect();
  const ratio = 9 / 16;

  let w = r.width;
  let h = w / ratio;

  if (h > r.height) {
    h = r.height;
    w = h * ratio;
  }

  world.style.width = `${Math.floor(w)}px`;
  world.style.height = `${Math.floor(h)}px`;
};

const bindBridge = () => {
  window.addEventListener('message', e => {
    const d = e.data || {};
    if (d.kind !== 'vitrina:game-host') return;

    if (d.type === 'GC_INIT') {
      state.bridgeId = d.bridgeId || d.payload?.bridgeId || '';
      setBridgeLabel(state.bridgeId ? 'bridge: connected' : 'bridge: no id');
      applySnapshot(d.payload?.snapshot);
      send('GC_READY', { at: Date.now(), userAgent: navigator.userAgent.slice(0, 80) });
      send('GC_REQUEST_SNAPSHOT');
      return;
    }

    if (!state.bridgeId || d.bridgeId !== state.bridgeId) return;

    if (d.type === 'GC_SNAPSHOT' || d.type === 'GC_HOST_STATE') {
      applySnapshot(d.payload);
    }
  });

  if (window.parent === window) {
    setBridgeLabel('standalone');
    applySnapshot({
      user: { displayName: 'Standalone' },
      progress: { level: 1, xp: 1250, achievementsUnlocked: 0, achievementsTotal: 0 },
      player: { title: '' }
    });
  }
};

const bindHotspots = () => {
  document.querySelectorAll('[data-door]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();

      const door = btn.dataset.door || 'unknown';
      const label = btn.getAttribute('aria-label') || door;

      showToast(`${label}: скоро откроется`);
      send('GC_DOOR_CLICKED', { door, at: Date.now() });
    });
  });
};

const init = () => {
  fitWorld();
  bindBridge();
  bindHotspots();

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitWorld, 80);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) fitWorld();
  });

  const img = $('bg-image');
  if (img?.complete) fitWorld();
  else img?.addEventListener('load', fitWorld, { once: true });
};

init();
