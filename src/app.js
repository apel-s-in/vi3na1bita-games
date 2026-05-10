// UID.001_(Playback safety invariant)_(game-app не управляет музыкой)_(нет audio/webAudio/playback commands)
// UID.006_(Lazy isolated micro-app)_(работает только внутри iframe или standalone preview)_(основной app загружает его по клику)
// UID.082_(Local truth vs external telemetry split)_(получаем только safe snapshot)_(не читаем localStorage/IndexedDB/token)
// UID.094_(No-paralysis rule)_(ошибка Game Center не ломает основное приложение)_(только postMessage + CSS panorama)

const $ = id => document.getElementById(id);
const state = { bridgeId: '', snapshot: null, yaw: 0, dragging: false, startX: 0, startYaw: 0 };

const log = msg => {
  const box = $('log');
  if (!box) return;
  const row = document.createElement('div');
  row.textContent = `[${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ${msg}`;
  box.prepend(row);
  while (box.children.length > 24) box.lastElementChild?.remove();
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

const applySnapshot = snapshot => {
  state.snapshot = snapshot || state.snapshot || {};
  const p = state.snapshot?.progress || {};
  const u = state.snapshot?.user || {};
  const pl = state.snapshot?.player || {};
  $('level').textContent = p.level ?? '—';
  $('xp').textContent = p.xp ?? '—';
  $('ach').textContent = `${p.achievementsUnlocked ?? 0}/${p.achievementsTotal ?? 0}`;
  $('track').textContent = pl.title || (pl.playing ? 'играет' : '—');
  $('user-line').textContent = u.displayName ? `${u.displayName} · ${p.level || 1} ур.` : 'гость';
};

const updateYaw = value => {
  state.yaw = ((value % 360) + 360) % 360;
  const x = -state.yaw / 360 * 50;
  $('panorama').style.transform = `translate3d(${x}%,0,0)`;
  $('yaw-line').textContent = `yaw ${Math.round(state.yaw)}° · потяни комнату`;
};

const bindRoom = () => {
  const room = $('room');
  if (!room) return;

  room.addEventListener('pointerdown', e => {
    state.dragging = true;
    state.startX = e.clientX;
    state.startYaw = state.yaw;
    room.setPointerCapture?.(e.pointerId);
  });

  room.addEventListener('pointermove', e => {
    if (!state.dragging) return;
    updateYaw(state.startYaw - (e.clientX - state.startX) * 0.42);
  });

  const end = e => {
    state.dragging = false;
    try { room.releasePointerCapture?.(e.pointerId); } catch {}
  };

  room.addEventListener('pointerup', end);
  room.addEventListener('pointercancel', end);

  document.querySelectorAll('[data-door]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const door = btn.dataset.door || 'unknown';
      log(`Дверь: ${door}`);
      send('GC_DOOR_CLICKED', { door, at: Date.now() });
    });
  });
};

const bindBridge = () => {
  window.addEventListener('message', e => {
    const d = e.data || {};
    if (d.kind !== 'vitrina:game-host') return;

    if (d.type === 'GC_INIT') {
      state.bridgeId = d.bridgeId || d.payload?.bridgeId || '';
      $('bridge-pill').textContent = state.bridgeId ? 'bridge: connected' : 'bridge: no id';
      applySnapshot(d.payload?.snapshot);
      log('GC_INIT принят от host');
      send('GC_READY', { at: Date.now(), userAgent: navigator.userAgent.slice(0, 80) });
      send('GC_REQUEST_SNAPSHOT');
      return;
    }

    if (!state.bridgeId || d.bridgeId !== state.bridgeId) return;

    if (d.type === 'GC_SNAPSHOT' || d.type === 'GC_HOST_STATE') {
      applySnapshot(d.payload);
      log(d.type === 'GC_SNAPSHOT' ? 'snapshot обновлён' : 'host state обновлён');
    }
  });

  if (window.parent === window) {
    $('bridge-pill').textContent = 'standalone';
    applySnapshot({
      user: { displayName: 'Standalone' },
      progress: { level: 1, xp: 0, achievementsUnlocked: 0, achievementsTotal: 0 },
      player: { title: '' }
    });
    log('Запущено standalone, без parent bridge');
  } else {
    log('Ожидаем GC_INIT от основного приложения...');
  }
};

const init = () => {
  bindRoom();
  bindBridge();
  updateYaw(Math.floor(Math.random() * 360));
  document.addEventListener('visibilitychange', () => {
    document.body.toggleAttribute('data-hidden', document.hidden);
    if (document.hidden) log('document hidden: рендер только CSS, таймеров нет');
  });
};

init();
