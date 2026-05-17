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
    mode: 'play',
    screen: 'tower',
    touchY: 0
  };

  const isStandalone = () => window.parent === window;

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

  const exitGame = async () => {
    showToast('Выход в основное приложение');
    closePanel();
    send('GC_CLOSE', { reason: 'user_exit', at: Date.now() });
    fitWorld();
  };

  const switchTab = tab => {
    closePanel();
    document.querySelectorAll('.bt-nav-item').forEach(btn => btn.classList.remove('is-active'));
    
    const bgImg = $('bg-image');
    const titleH1 = document.querySelector('.bt-title h1');
    const hotspots = document.querySelectorAll('.bt-hotspot');

    if (tab === 'friends') {
      $('nav-friends')?.classList.add('is-active');
      if (titleH1) titleH1.textContent = 'Друзья';
      if (bgImg) bgImg.src = './assets/tower/bg1.webp';
      hotspots.forEach(h => h.style.display = 'none');
    } else {
      $('nav-tower')?.classList.add('is-active');
      if (titleH1) titleH1.textContent = 'Башня';
      if (bgImg) bgImg.src = './assets/tower/bg.webp';
      hotspots.forEach(h => h.style.display = '');
    }
  };

  const getPanel = () => {
    let panel = $('bt-panel');
    if (panel) return panel;

    const scene = $('scene');
    if (!scene) return null;

    panel = document.createElement('section');
    panel.className = 'bt-panel';
    panel.id = 'bt-panel';
    panel.hidden = true;
    scene.appendChild(panel);

    return panel;
  };

  const closePanel = () => {
    const panel = $('bt-panel');
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = '';
    }

    const gameHost = $('bt-game-host');
    if (gameHost) {
      gameHost.hidden = true;
      gameHost.innerHTML = '';
    }

    state.screen = 'tower';
  };

  const closeGameHost = () => {
    const gameHost = $('bt-game-host');
    if (gameHost) {
      gameHost.hidden = true;
      gameHost.innerHTML = '';
    }
    closePanel(); // Закрываем все панели, чтобы оказаться в главном виде Башни
    fitWorld();
  };

  const openGame = gameId => {
    if (gameId !== 'war_hearts') return;

    const scene = $('scene');
    if (!scene) return;

    const panel = $('bt-panel');
    if (panel) panel.hidden = true;

    let gameHost = $('bt-game-host');
    if (!gameHost) {
      gameHost = document.createElement('section');
      gameHost.className = 'bt-game-host';
      gameHost.id = 'bt-game-host';
      scene.appendChild(gameHost);
    }

    const launchUrl = new URL('./war_hearts/', window.location.href);
    const params = new URLSearchParams(window.location.search);

    launchUrl.searchParams.set('host', 'game_center');

    if (params.get('room')) launchUrl.searchParams.set('room', params.get('room'));
    if (params.get('key')) launchUrl.searchParams.set('key', params.get('key'));
    if (params.get('secret')) launchUrl.searchParams.set('key', params.get('secret'));

    const safeLaunchUrl = launchUrl.toString().replace(/"/g, '&quot;');

    gameHost.hidden = false;
    // Оставляем только iframe во весь экран. Сама игра нарисует свою шапку и крестик.
    gameHost.innerHTML = `
      <iframe
        class="bt-game-frame"
        title="Война Сердец"
        src="${safeLaunchUrl}"
        allow="fullscreen; microphone"
        allowfullscreen
        referrerpolicy="no-referrer"
      ></iframe>
    `;

    showToast('Открываем Войну Сердец');
    send('GC_DOOR_CLICKED', { door: 'arena:war_hearts', at: Date.now() });
    fitWorld();
  };

  const openArena = () => {
    const panel = getPanel();
    if (!panel) return;

    state.screen = 'arena';
    panel.hidden = false;
    panel.innerHTML = `
      <div class="bt-panel-head">
        <button class="bt-panel-back" type="button" data-panel-close aria-label="Закрыть">✕</button>
        <div>
          <h2>Арена Турниров</h2>
          <p>Выберите игру для дуэли или тренировки</p>
        </div>
      </div>

      <div class="bt-games-list">
        <button class="bt-game-card" type="button" data-game="war_hearts">
          <div class="bt-game-icon">💔</div>
          <div class="bt-game-info">
            <h3>Война Сердец</h3>
            <p>Морской бой 10×10 в стилистике разбитых сердец. Дуэль, чат, голос и режим против компьютера.</p>
            <div class="bt-game-tags">
              <span>P2P</span>
              <span>10×10</span>
              <span>Voice</span>
              <span>Demo AI</span>
            </div>
          </div>
          <div class="bt-game-arrow">›</div>
        </button>

        <div class="bt-game-card bt-game-card-soon" aria-disabled="true">
          <div class="bt-game-icon">🏆</div>
          <div class="bt-game-info">
            <h3>Скоро новая дуэль</h3>
            <p>Следующая мини-игра появится отдельным модулем в Game Center.</p>
            <div class="bt-game-tags">
              <span>soon</span>
            </div>
          </div>
        </div>
      </div>
    `;

    panel.querySelector('[data-panel-close]')?.addEventListener('click', closePanel);
    panel.querySelector('[data-game="war_hearts"]')?.addEventListener('click', () => openGame('war_hearts'));

    showToast('Арена Турниров');
    send('GC_DOOR_CLICKED', { door: 'arena', at: Date.now() });
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
        const gameIframe = document.querySelector('.bt-game-frame');
        if (gameIframe) gameIframe.contentWindow.postMessage({ kind: 'vitrina:game-host', type: 'GC_SNAPSHOT', payload: d.payload }, '*');
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
      send('GC_PARENT_SCROLL', { deltaY: e.deltaY, at: Date.now() });
    }, { passive: true });

    scene.addEventListener('touchstart', e => {
      state.touchY = e.touches?.[0]?.clientY || 0;
    }, { passive: true });
  };

  const bindHotspots = () => {
    $('exit-game')?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      exitGame();
    });

    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        switchTab(btn.dataset.tab);
      });
    });

    document.querySelectorAll('[data-door]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();

        const door = btn.dataset.door || 'unknown';
        const label = btn.getAttribute('aria-label') || door;

        if (door === 'arena') {
          openArena();
          return;
        }

        showToast(`${label}: скоро откроется`);
        send('GC_DOOR_CLICKED', { door, at: Date.now() });
      });
    });
  };

  const init = () => {
    document.body.dataset.mode = 'play';
    
    // Слушаем сигналы от внутренней игры (Война Сердец)
    window.addEventListener('message', e => {
      if (e.data?.kind === 'vitrina:game') {
        if (e.data.type === 'GC_CLOSE') closeGameHost();
        else if (e.data.type === 'GC_SAVE_DATA') send('GC_SAVE_DATA', e.data.payload);
        else if (e.data.type === 'GC_READY' && state.snapshot) {
          const gameIframe = document.querySelector('.bt-game-frame');
          if (gameIframe) gameIframe.contentWindow.postMessage({ kind: 'vitrina:game-host', type: 'GC_SNAPSHOT', payload: state.snapshot }, '*');
        }
      }
    });

    fitWorld();
    bindBridge();
    bindHotspots();
    bindScrollProxy();

    const launchParams = new URLSearchParams(window.location.search);
    if (
      (launchParams.get('gcGame') === 'war_hearts' || launchParams.get('game') === 'war_hearts') &&
      launchParams.get('room') &&
      (launchParams.get('key') || launchParams.get('secret'))
    ) {
      setTimeout(() => openGame('war_hearts'), 120);
    }

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
})();
