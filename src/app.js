// UID.001_(Playback safety invariant)_(game-app не управляет музыкой)_(нет audio/webAudio/playback commands)
// UID.006_(Lazy isolated micro-app)_(работает только внутри iframe или standalone preview)_(основной app загружает его по клику)
// UID.082_(Local truth vs external telemetry split)_(получаем только safe snapshot)_(не читаем localStorage/IndexedDB/token)
// UID.094_(No-paralysis rule)_(ошибка Game Center не ломает основное приложение)_(только postMessage + CSS/Canvas panorama)

const $ = id => document.getElementById(id);
const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

const state = {
  bridgeId: '',
  snapshot: null,
  yaw: 0,
  dragging: false,
  startX: 0,
  startYaw: 0,
  lastDoor: ''
};

const log = msg => {
  const box = $('log');
  if (!box) return;
  const row = document.createElement('div');
  row.textContent = `[${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ${msg}`;
  box.prepend(row);
  while (box.children.length > 20) box.lastElementChild?.remove();
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

const fmtNum = value => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}K`.replace('.', ',');
  return String(Math.round(n));
};

const applySnapshot = snapshot => {
  state.snapshot = snapshot || state.snapshot || {};
  const p = state.snapshot?.progress || {};
  const u = state.snapshot?.user || {};
  const pl = state.snapshot?.player || {};

  $('level').textContent = p.level ?? '—';
  $('xp').textContent = fmtNum(p.xp ?? 0);
  $('ach').textContent = `${p.achievementsUnlocked ?? 0}/${p.achievementsTotal ?? 0}`;
  $('track').textContent = pl.title || (pl.playing ? 'играет' : '—');

  const name = u.displayName || 'гость';
  const level = p.level || 1;
  $('user-line').textContent = `${name} · ${level} ур.`;
};

const updateYaw = value => {
  state.yaw = ((value % 360) + 360) % 360;
  const x = -state.yaw / 360 * 66.666;
  const panorama = $('panorama');
  if (panorama) panorama.style.transform = `translate3d(${x}%,0,0)`;

  const sector = Math.round(state.yaw / 60) % 6;
  const labels = ['Game Hub', 'Трофеи', 'Достижения', 'Турниры', 'Магазин', 'Профиль'];
  $('yaw-line').textContent = `${Math.round(state.yaw)}° · ${labels[sector]} · потяни комнату`;
};

const bindRoom = () => {
  const room = $('room');
  if (!room) return;

  room.addEventListener('pointerdown', e => {
    if (e.target?.closest?.('button')) return;
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
      state.lastDoor = door;
      log(`Открыта дверь: ${door}`);
      send('GC_DOOR_CLICKED', { door, yaw: Math.round(state.yaw), at: Date.now() });
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

const createHeartEngine = canvas => {
  if (!canvas || prefersReduced) {
    return { start() {}, stop() {}, resize() {} };
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  const particles = [];
  let raf = 0;
  let running = false;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let startedAt = performance.now();

  const rand = (min, max) => min + Math.random() * (max - min);

  const heartPoint = t => {
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    return { x, y };
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(1, Math.floor(rect.width * dpr));
    height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.width = width;
    canvas.height = height;
  };

  const resetParticle = p => {
    const t = rand(0, Math.PI * 2);
    const pt = heartPoint(t);
    const scale = Math.min(width, height) / 38;
    const cx = width / 2;
    const cy = height * 0.49;

    p.t = t;
    p.speed = rand(0.004, 0.011);
    p.x = cx + pt.x * scale + rand(-40, 40) * dpr;
    p.y = cy + pt.y * scale + rand(-40, 40) * dpr;
    p.vx = 0;
    p.vy = 0;
    p.size = rand(0.8, 2.1) * dpr;
    p.force = rand(0.035, 0.075);
    p.hue = rand(348, 365);
    p.alpha = rand(0.28, 0.82);
    p.trace = Array.from({ length: 9 }, () => ({ x: p.x, y: p.y }));
  };

  const init = () => {
    resize();
    particles.length = 0;
    const base = Math.min(width, height);
    const count = Math.max(70, Math.min(190, Math.floor(base / 2.25)));

    for (let i = 0; i < count; i++) {
      const p = {};
      resetParticle(p);
      particles.push(p);
    }
  };

  const drawCoreGlow = time => {
    const pulse = 1 + Math.sin(time * 0.004) * 0.06;
    const cx = width / 2;
    const cy = height * 0.49;
    const r = Math.min(width, height) * 0.32 * pulse;

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255, 45, 85, .28)');
    g.addColorStop(0.28, 'rgba(232, 1, 0, .16)');
    g.addColorStop(0.58, 'rgba(121, 231, 255, .06)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawCrimsonThreads = time => {
    const cx = width / 2;
    const cy = height * 0.49;
    const scale = Math.min(width, height) / 38;
    const beat = 1 + Math.sin(time * 0.006) * 0.045 + Math.sin(time * 0.013) * 0.018;

    ctx.globalCompositeOperation = 'lighter';

    for (const p of particles) {
      p.t += p.speed;
      if (p.t > Math.PI * 2) p.t -= Math.PI * 2;

      const pt = heartPoint(p.t);
      const tx = cx + pt.x * scale * beat;
      const ty = cy + pt.y * scale * beat;

      p.vx += (tx - p.x) * p.force;
      p.vy += (ty - p.y) * p.force;
      p.vx *= 0.78;
      p.vy *= 0.78;
      p.x += p.vx;
      p.y += p.vy;

      p.trace.unshift({ x: p.x, y: p.y });
      p.trace.length = 9;

      ctx.beginPath();
      for (let i = 0; i < p.trace.length - 1; i++) {
        const a = p.trace[i];
        const b = p.trace[i + 1];
        ctx.strokeStyle = `hsla(${p.hue}, 100%, ${58 - i * 2}%, ${p.alpha * (1 - i / p.trace.length)})`;
        ctx.lineWidth = Math.max(0.4 * dpr, p.size * (1 - i / p.trace.length));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      ctx.fillStyle = `hsla(${p.hue}, 100%, 68%, ${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const drawShards = time => {
    const cx = width / 2;
    const cy = height * 0.49;
    const amount = 18;

    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < amount; i++) {
      const a = (i / amount) * Math.PI * 2 + Math.sin(time * 0.0008 + i) * 0.08;
      const r1 = Math.min(width, height) * (0.18 + (i % 5) * 0.018);
      const r2 = r1 + Math.min(width, height) * 0.18;
      const x1 = cx + Math.cos(a) * r1;
      const y1 = cy + Math.sin(a) * r1 * 0.72;
      const x2 = cx + Math.cos(a) * r2;
      const y2 = cy + Math.sin(a) * r2 * 0.72;

      ctx.strokeStyle = i % 3 === 0 ? 'rgba(121,231,255,.14)' : 'rgba(255,45,85,.12)';
      ctx.lineWidth = 0.8 * dpr;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  };

  const frame = time => {
    if (!running || document.hidden) return;

    ctx.clearRect(0, 0, width, height);
    drawCoreGlow(time - startedAt);
    drawShards(time - startedAt);
    drawCrimsonThreads(time - startedAt);

    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (running || document.hidden) return;
    running = true;
    startedAt = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  init();

  return { start, stop, resize: init };
};

const init = () => {
  bindRoom();
  bindBridge();

  const initialYaw = Math.floor(Math.random() * 360);
  updateYaw(initialYaw);

  const heartEngine = createHeartEngine($('heart-canvas'));
  heartEngine.start();

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => heartEngine.resize(), 120);
  });

  document.addEventListener('visibilitychange', () => {
    document.body.toggleAttribute('data-hidden', document.hidden);
    if (document.hidden) {
      heartEngine.stop();
      log('document hidden: Canvas-анимация остановлена');
    } else {
      heartEngine.resize();
      heartEngine.start();
      log('document visible: Canvas-анимация запущена');
    }
  });
};

init();
