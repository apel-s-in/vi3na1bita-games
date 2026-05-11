// UID.001_(Playback safety invariant)_(game-app не управляет музыкой)_(нет audio/WebAudio/playback commands)
// UID.006_(Lazy isolated micro-app)_(работает внутри iframe или standalone preview)_(основной app загружает его по клику)
// UID.082_(Local truth vs external telemetry split)_(получаем только safe snapshot)_(не читаем localStorage/IndexedDB/token)
// UID.094_(No-paralysis rule)_(ошибка Game Center не ломает основное приложение)_(только postMessage + fixed 9:16 image menu)

(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const state = {
    bridgeId: '',
    snapshot: null,
    mode: 'lobby',
    touchY: 0
  };

  const isStandalone = () => window.parent === window;
  const isLobby = () => state.mode !== 'play';

  const send = (type, payload = {}) => {
    if (!state.bridgeId || isStandalone()) return false;
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

  const fmtNum = value => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '0';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace('.', ',')}M`;
    if (n >= 1000) return `${Math.round(n / 100) / 10}K`.replace('.', ',');
    return String(Math.round(n));
  };

  const setBridgeLabel = text => {
    const el = $('bridge-pill');
    if (el) el.textContent = text;
  };

  const setMode = mode => {
    state.mode = mode === 'play' ? 'play' : 'lobby';
    document.body.dataset.mode = state.mode;
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

  const applySnapshot = snapshot => {
    state.snapshot = snapshot || state.snapshot || {};

    const progress = state.snapshot?.progress || {};
    const user = state.snapshot?.user || {};

    const shards = $('shards-count');
    if (shards) shards.textContent = fmtNum(progress.xp || 1250);

    const avatarBox = $('avatar-box');
    if (avatarBox && user.avatar) {
      avatarBox.innerHTML = `<img src="${String(user.avatar).replace(/"/g, '&quot;')}" alt="">`;
    }
  };

  const requestGameFullscreen = async () => {
    const scene = $('scene');
    if (!scene || !scene.requestFullscreen) return false;
    try {
      await scene.requestFullscreen();
      return true;
    } catch {
      return false;
    }
  };

  const exitGameFullscreen = async () => {
    if (!document.fullscreenElement || !document.exitFullscreen) return false;
    try {
      await document.exitFullscreen();
      return true;
    } catch {
      return false;
    }
  };

  const enterGame = async () => {
    setMode('play');
    showToast('Башня открыта');
    send('GC_DOOR_CLICKED', { door: 'enter_game', at: Date.now() });
    await requestGameFullscreen();
    fitWorld();
  };

  const exitGame = async () => {
    showToast('Выход из Башни');
    send('GC_CLOSE', { reason: 'user_exit', at: Date.now() });
    await exitGameFullscreen();
    setMode('lobby');
    fitWorld();
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

    if (isStandalone()) {
      setBridgeLabel('standalone');
      applySnapshot({
        user: { displayName: 'Standalone' },
        progress: { level: 1, xp: 1250, achievementsUnlocked: 0, achievementsTotal: 0 },
        player: { title: '' }
      });
    }
  };

  const bindScrollProxy = () => {
    const scene = $('scene');
    if (!scene) return;

    scene.addEventListener('wheel', e => {
      if (!isLobby()) return;
      send('GC_PARENT_SCROLL', { deltaY: e.deltaY, at: Date.now() });
    }, { passive: true });

    scene.addEventListener('touchstart', e => {
      state.touchY = e.touches?.[0]?.clientY || 0;
    }, { passive: true });

    scene.addEventListener('touchmove', e => {
      if (!isLobby()) return;
      const y = e.touches?.[0]?.clientY || state.touchY;
      const deltaY = state.touchY - y;
      state.touchY = y;
      if (Math.abs(deltaY) > 1) send('GC_PARENT_SCROLL', { deltaY, at: Date.now() });
    }, { passive: true });
  };

  const bindHotspots = () => {
    $('enter-game')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      enterGame();
    });

    $('exit-game')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      exitGame();
    });

    document.querySelectorAll('[data-door]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();

        if (isLobby()) return;

        const door = btn.dataset.door || 'unknown';
        const label = btn.getAttribute('aria-label') || door;

        showToast(`${label}: скоро откроется`);
        send('GC_DOOR_CLICKED', { door, at: Date.now() });
      });
    });
  };

  const init = () => {
    setMode('lobby');
    fitWorld();
    bindBridge();
    bindHotspots();
    bindScrollProxy();

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitWorld, 80);
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) fitWorld();
    });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && state.mode === 'play') {
        fitWorld();
      }
    });

    const img = $('bg-image');
    if (img?.complete) fitWorld();
    else img?.addEventListener('load', fitWorld, { once: true });
  };

  init();
})();
