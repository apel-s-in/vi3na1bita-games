// UID.001_(Playback safety invariant)_(game-app не управляет музыкой)_(нет audio/WebAudio/playback commands)
// UID.006_(Lazy isolated micro-app)_(работает внутри iframe или standalone preview)_(основной app загружает его по клику)
// UID.082_(Local truth vs external telemetry split)_(получаем только safe snapshot)_(не читаем localStorage/IndexedDB/token)
// UID.094_(No-paralysis rule)_(ошибка Game Center не ломает основное приложение)_(только postMessage + CSS/Canvas parallax)

const $ = id => document.getElementById(id);
const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

const state = {
  bridgeId: '',
  snapshot: null,
  activeDoor: '',
  pointerDown: false,
  targetX: 0,
  targetY: 0,
  lookX: 0,
  lookY: 0,
  startX: 0,
  startY: 0,
  dragX: 0,
  dragY: 0,
  targetDragX: 0,
  targetDragY: 0,
  raf: 0
};

const scene = $('scene');

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
  }, 1700);
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

  const progress = state.snapshot?.progress || {};
  const user = state.snapshot?.user || {};

  const shardText = $('shards-count');
  if (shardText) shardText.textContent = fmtNum(progress.xp || 1250);

  const avatar = document.querySelector('.bt-avatar img');
  if (avatar && user.avatar) avatar.src = user.avatar;
};

const bindBridge = () => {
  window.addEventListener('message', e => {
    const d = e.data || {};
    if (d.kind !== 'vitrina:game-host') return;

    if (d.type === 'GC_INIT') {
      state.bridgeId = d.bridgeId || d.payload?.bridgeId || '';
      $('bridge-pill').textContent = state.bridgeId ? 'bridge: connected' : 'bridge: no id';
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
    $('bridge-pill').textContent = 'standalone';
    applySnapshot({
      user: { displayName: 'Standalone' },
      progress: { level: 1, xp: 1250, achievementsUnlocked: 0, achievementsTotal: 0 },
      player: { title: '' }
    });
  }
};

const bindHotspots = () => {
  document.querySelectorAll('.bt-hotspot').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();

      const door = btn.dataset.door || 'unknown';
      const title = btn.querySelector('b')?.textContent || door;

      state.activeDoor = door;

      document.querySelectorAll('.bt-hotspot').forEach(x => {
        x.classList.toggle('is-active', x === btn);
      });

      showToast(`${title}: скоро откроется`);
      send('GC_DOOR_CLICKED', { door, at: Date.now() });

      spawnBurst(btn);
    });
  });

  document.querySelectorAll('.bt-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bt-nav-item').forEach(x => {
        x.classList.toggle('is-active', x === btn);
      });

      const nav = btn.dataset.nav || 'unknown';
      showToast(`Раздел: ${btn.textContent.trim()}`);
      send('GC_DOOR_CLICKED', { door: `nav:${nav}`, at: Date.now() });
    });
  });
};

const getPointerLook = e => {
  const r = scene.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  return {
    x: Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width / 2))),
    y: Math.max(-1, Math.min(1, (e.clientY - cy) / (r.height / 2)))
  };
};

const bindParallaxInput = () => {
  if (!scene) return;

  scene.addEventListener('pointerdown', e => {
    if (e.target?.closest?.('button')) return;

    state.pointerDown = true;
    state.startX = e.clientX;
    state.startY = e.clientY;
    scene.setPointerCapture?.(e.pointerId);
  });

  scene.addEventListener('pointermove', e => {
    const look = getPointerLook(e);
    state.targetX = look.x;
    state.targetY = look.y;

    if (state.pointerDown) {
      state.targetDragX += (e.movementX || 0) * 0.18;
      state.targetDragY += (e.movementY || 0) * 0.08;
      state.targetDragX = Math.max(-90, Math.min(90, state.targetDragX));
      state.targetDragY = Math.max(-40, Math.min(40, state.targetDragY));
    }
  });

  const end = e => {
    state.pointerDown = false;
    try { scene.releasePointerCapture?.(e.pointerId); } catch {}
  };

  scene.addEventListener('pointerup', end);
  scene.addEventListener('pointercancel', end);

  window.addEventListener('deviceorientation', e => {
    if (!Number.isFinite(e.gamma) || !Number.isFinite(e.beta)) return;
    state.targetX = Math.max(-1, Math.min(1, e.gamma / 28));
    state.targetY = Math.max(-1, Math.min(1, (e.beta - 45) / 42));
  }, { passive: true });
};

const updateParallax = () => {
  state.lookX += (state.targetX - state.lookX) * 0.075;
  state.lookY += (state.targetY - state.lookY) * 0.075;
  state.dragX += (state.targetDragX - state.dragX) * 0.08;
  state.dragY += (state.targetDragY - state.dragY) * 0.08;

  document.querySelectorAll('[data-depth]').forEach(el => {
    const depth = Number(el.dataset.depth || 0);
    const x = state.dragX * depth + state.lookX * depth * 46;
    const y = state.dragY * depth + state.lookY * depth * 30;

    if (el.classList.contains('bt-hotspot')) {
      el.style.translate = `${x}px ${y}px`;
    } else {
      el.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
  });
};

const createParticleEngine = canvas => {
  if (!canvas || prefersReduced) {
    return { start() {}, stop() {}, burst() {}, resize() {} };
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  const particles = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = 0;
  let running = false;

  const rand = (min, max) => min + Math.random() * (max - min);

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(1, Math.floor(r.width * dpr));
    height = Math.max(1, Math.floor(r.height * dpr));
    canvas.width = width;
    canvas.height = height;
  };

  const addParticle = (x, y, burst = false) => {
    particles.push({
      x,
      y,
      vx: rand(-0.35, 0.35) * dpr * (burst ? 6 : 1),
      vy: rand(-0.55, -0.05) * dpr * (burst ? 6 : 1),
      life: burst ? rand(28, 62) : rand(90, 220),
      maxLife: burst ? 62 : 220,
      size: rand(1, burst ? 4 : 2.6) * dpr,
      hue: Math.random() > 0.35 ? rand(186, 198) : rand(342, 354)
    });
  };

  const seed = () => {
    particles.length = 0;
    for (let i = 0; i < 95; i++) {
      addParticle(rand(0, width), rand(height * .12, height * .95));
    }
  };

  const burst = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    const x = (clientX - r.left) * dpr;
    const y = (clientY - r.top) * dpr;

    for (let i = 0; i < 38; i++) addParticle(x, y, true);
  };

  const frame = () => {
    if (!running || document.hidden) return;

    updateParallax();

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];

      p.life -= 1;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.006 * dpr;

      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = `hsla(${p.hue}, 100%, 62%, ${alpha * .8})`;
      ctx.shadowBlur = 12 * dpr;
      ctx.shadowColor = `hsla(${p.hue}, 100%, 60%, .9)`;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();

      if (p.life <= 0 || p.y < -20 || p.y > height + 30) {
        particles.splice(i, 1);
      }
    }

    ctx.shadowBlur = 0;

    while (particles.length < 95) {
      addParticle(rand(0, width), height + rand(0, 80) * dpr);
    }

    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (running || document.hidden) return;
    running = true;
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  resize();
  seed();

  return { start, stop, burst, resize: () => { resize(); seed(); } };
};

let particleEngine = null;

const spawnBurst = el => {
  if (!particleEngine || !el) return;
  const r = el.getBoundingClientRect();
  particleEngine.burst(r.left + r.width / 2, r.top + r.height / 2);
};

const init = () => {
  bindBridge();
  bindHotspots();
  bindParallaxInput();

  particleEngine = createParticleEngine($('particles'));
  particleEngine.start();

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => particleEngine.resize(), 140);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      particleEngine.stop();
    } else {
      particleEngine.resize();
      particleEngine.start();
    }
  });
};

init();
