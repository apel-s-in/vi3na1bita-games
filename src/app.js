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
  dragX: 0,
  dragY: 0,
  targetDragX: 0,
  targetDragY: 0,
  parallaxRaf: 0,
  parallaxFrames: 0,
  artRatio: 9 / 16
};

const scene = $('scene');
const world = $('world');

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
  }, 1500);
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

const bindImageFallbacks = () => {
  document.querySelectorAll('img').forEach(img => {
    img.addEventListener('error', () => {
      img.hidden = true;
      img.closest('.bt-hotspot')?.classList.add('is-missing-icon');
    }, { once: true });
  });
};

const fitWorldToBackground = () => {
  if (!scene || !world) return;

  const rect = scene.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const ratio = state.artRatio || (9 / 16);

  let h = rect.height;
  let w = h * ratio;

  if (w < rect.width) {
    w = rect.width;
    h = w / ratio;
  }

  world.style.width = `${Math.ceil(w)}px`;
  world.style.height = `${Math.ceil(h)}px`;
};

const bindArtRatio = () => {
  const img = $('bg-image');

  const apply = () => {
    if (img?.naturalWidth && img?.naturalHeight) {
      state.artRatio = img.naturalWidth / img.naturalHeight;
      scene?.style.setProperty('--bt-art-ratio', `${img.naturalWidth} / ${img.naturalHeight}`);
    }
    fitWorldToBackground();
  };

  if (img?.complete) apply();
  else img?.addEventListener('load', apply, { once: true });

  fitWorldToBackground();
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

const applyParallaxFrame = () => {
  state.parallaxRaf = 0;

  state.lookX += (state.targetX - state.lookX) * 0.12;
  state.lookY += (state.targetY - state.lookY) * 0.12;
  state.dragX += (state.targetDragX - state.dragX) * 0.1;
  state.dragY += (state.targetDragY - state.dragY) * 0.1;

  const stillMoving =
    Math.abs(state.targetX - state.lookX) > 0.002 ||
    Math.abs(state.targetY - state.lookY) > 0.002 ||
    Math.abs(state.targetDragX - state.dragX) > 0.05 ||
    Math.abs(state.targetDragY - state.dragY) > 0.05 ||
    state.pointerDown;

  document.querySelectorAll('[data-depth]').forEach(el => {
    const depth = Number(el.dataset.depth || 0);
    const x = state.dragX * depth + state.lookX * depth * 28;
    const y = state.dragY * depth + state.lookY * depth * 18;

    if (el.classList.contains('bt-hotspot')) {
      el.style.translate = `${x}px ${y}px`;
    } else {
      el.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
  });

  if (stillMoving && state.parallaxFrames < 90 && !document.hidden) {
    state.parallaxFrames++;
    state.parallaxRaf = requestAnimationFrame(applyParallaxFrame);
  } else {
    state.parallaxFrames = 0;
  }
};

const requestParallax = () => {
  if (prefersReduced || document.hidden || state.parallaxRaf) return;
  state.parallaxFrames = 0;
  state.parallaxRaf = requestAnimationFrame(applyParallaxFrame);
};

const bindParallaxInput = () => {
  if (!scene) return;

  scene.addEventListener('pointerdown', e => {
    if (e.target?.closest?.('button')) return;

    state.pointerDown = true;
    scene.setPointerCapture?.(e.pointerId);
    requestParallax();
  });

  scene.addEventListener('pointermove', e => {
    const look = getPointerLook(e);
    state.targetX = look.x;
    state.targetY = look.y;

    if (state.pointerDown) {
      state.targetDragX += (e.movementX || 0) * 0.12;
      state.targetDragY += (e.movementY || 0) * 0.05;
      state.targetDragX = Math.max(-42, Math.min(42, state.targetDragX));
      state.targetDragY = Math.max(-18, Math.min(18, state.targetDragY));
    }

    requestParallax();
  });

  const end = e => {
    state.pointerDown = false;
    try { scene.releasePointerCapture?.(e.pointerId); } catch {}
    requestParallax();
  };

  scene.addEventListener('pointerup', end);
  scene.addEventListener('pointercancel', end);
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
      particleEngine?.burstElement?.(btn);
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
      particleEngine?.burstElement?.(btn);
    });
  });
};

const createParticleEngine = canvas => {
  if (!canvas || prefersReduced) {
    return { burstElement() {}, resize() {}, stop() {} };
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  const particles = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = 0;

  const rand = (min, max) => min + Math.random() * (max - min);

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(1.25, window.devicePixelRatio || 1);
    width = Math.max(1, Math.floor(r.width * dpr));
    height = Math.max(1, Math.floor(r.height * dpr));
    canvas.width = width;
    canvas.height = height;
  };

  const addParticle = (x, y) => {
    particles.push({
      x,
      y,
      vx: rand(-2.8, 2.8) * dpr,
      vy: rand(-3.4, 1.2) * dpr,
      life: rand(18, 42),
      maxLife: 42,
      size: rand(1, 3.2) * dpr,
      hue: Math.random() > 0.45 ? rand(186, 196) : rand(344, 354)
    });
  };

  const frame = () => {
    raf = 0;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];

      p.life -= 1;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.045 * dpr;

      const alpha = Math.max(0, p.life / p.maxLife);

      ctx.fillStyle = `hsla(${p.hue}, 100%, 62%, ${alpha * .75})`;
      ctx.shadowBlur = 7 * dpr;
      ctx.shadowColor = `hsla(${p.hue}, 100%, 60%, .75)`;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();

      if (p.life <= 0) particles.splice(i, 1);
    }

    ctx.shadowBlur = 0;

    if (particles.length && !document.hidden) {
      raf = requestAnimationFrame(frame);
    }
  };

  const burst = (clientX, clientY) => {
    if (document.hidden) return;

    const r = canvas.getBoundingClientRect();
    const x = (clientX - r.left) * dpr;
    const y = (clientY - r.top) * dpr;

    for (let i = 0; i < 18; i++) addParticle(x, y);

    if (!raf) raf = requestAnimationFrame(frame);
  };

  const burstElement = el => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2);
  };

  const stop = () => {
    particles.length = 0;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    ctx.clearRect(0, 0, width, height);
  };

  resize();

  return { burstElement, resize, stop };
};

let particleEngine = null;

const init = () => {
  bindImageFallbacks();
  bindArtRatio();
  bindBridge();
  bindHotspots();
  bindParallaxInput();

  particleEngine = createParticleEngine($('particles'));

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      fitWorldToBackground();
      particleEngine?.resize?.();
      requestParallax();
    }, 120);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      particleEngine?.stop?.();
      if (state.parallaxRaf) cancelAnimationFrame(state.parallaxRaf);
      state.parallaxRaf = 0;
      return;
    }

    fitWorldToBackground();
    particleEngine?.resize?.();
    requestParallax();
  });
};

init();
