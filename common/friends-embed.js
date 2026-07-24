/**
 * /Games/common/friends-embed.js
 * Канонический /Friends/friends-ui.js внутри sandbox iframe.
 * Все data/E2EE операции выполняются основным приложением через RPC.
 */

import {
  attachEmbeddedFriendsCoreMethods
} from 'https://vi3na1bita.website.yandexcloud.net/Friends/embedded-rpc-contract.js?v=9.0.8';

const FRIENDS_BASE =
  'https://vi3na1bita.website.yandexcloud.net/Friends';
const DEFAULT_BUILD = '9.0.8';
const RPC_TIMEOUT_MS = 20000;

const pending = new Map();
const safetyCache = new Map();

const safe = value =>
  String(value == null ? '' : value).trim();

const makeId = prefix =>
  `${prefix}_${Date.now().toString(36)}_` +
  `${Math.random().toString(36).slice(2, 10)}`;

const getBridgeId = () =>
  safe(window.__GC_BRIDGE_ID);

const postToHost = (type, payload = {}) => {
  const bridgeId = getBridgeId();

  if (!bridgeId || window.parent === window) {
    return false;
  }

  const capabilityToken = safe(
    window.__GC_CAPABILITY_TOKEN
  );

  window.parent.postMessage({
    kind: 'vitrina:game',
    bridgeId,
    capabilityToken,
    type,
    payload: {
      ...payload,
      capabilityToken
    }
  }, '*');

  return true;
};

const requestHost = (method, args = []) => {
  const requestId = makeId('friends_rpc');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('friends_rpc_timeout'));
    }, RPC_TIMEOUT_MS);

    pending.set(requestId, {
      resolve,
      reject,
      timer
    });

    if (!postToHost('GC_FRIENDS_REQUEST', {
      requestId,
      method: safe(method),
      args: Array.isArray(args) ? args : []
    })) {
      clearTimeout(timer);
      pending.delete(requestId);
      reject(new Error('friends_parent_bridge_required'));
    }
  });
};

window.addEventListener('message', event => {
  const data = event.data || {};

  if (
    data.kind !== 'vitrina:game-host' ||
    data.type !== 'GC_FRIENDS_RESPONSE'
  ) return;

  const payload = data.payload || {};
  const requestId = safe(payload.requestId);
  const row = pending.get(requestId);

  if (!row) return;

  pending.delete(requestId);
  clearTimeout(row.timer);

  if (!payload.ok) {
    const error = new Error(
      payload.error || 'friends_rpc_failed'
    );
    error.status = Number(payload.status || 500);
    row.reject(error);
    return;
  }

  row.resolve(payload.result);
});

const ensureStyles = build => {
  const id = 'vi3-canonical-friends-styles';
  const existing = document.getElementById(id);

  if (existing?.dataset.ready === '1') {
    return Promise.resolve(true);
  }

  if (existing?._readyPromise) {
    return existing._readyPromise;
  }

  const link = existing || document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href =
    `${FRIENDS_BASE}/styles.css?v=${encodeURIComponent(build)}`;

  link._readyPromise = new Promise((resolve, reject) => {
    link.addEventListener('load', () => {
      link.dataset.ready = '1';
      resolve(true);
    }, { once: true });

    link.addEventListener('error', () => {
      reject(new Error('friends_styles_load_failed'));
    }, { once: true });
  });

  if (!existing) document.head.appendChild(link);
  return link._readyPromise;
};

class FriendsRpcCore {
  constructor(identity = {}) {
    this.identity = {
      friendId: safe(identity.friendId),
      displayName: safe(identity.displayName || 'Слушатель'),
      avatar: safe(identity.avatar || ''),
      yandexLinked: !!identity.yandexLinked
    };
    this.chatE2eeV2 = true;

    attachEmbeddedFriendsCoreMethods(
      this,
      (method, args) => requestHost(method, args)
    );
  }

  setIdentity(identity = {}) {
    this.identity = {
      friendId: safe(identity.friendId),
      displayName: safe(identity.displayName || 'Слушатель'),
      avatar: safe(identity.avatar || ''),
      yandexLinked: !!identity.yandexLinked
    };

    return this.identity;
  }

  isReady() {
    return !!(
      this.identity.friendId &&
      this.identity.yandexLinked
    );
  }

  call(method, ...args) {
    return requestHost(method, args);
  }

  getSafetyVerification(friendId) {
    return safetyCache.get(safe(friendId)) || null;
  }

  setSafetyVerified(friendId, safety) {
    const key = safe(friendId);
    const row = {
      safetyId: safe(safety?.safetyId),
      verifiedAt: Date.now()
    };

    safetyCache.set(key, row);

    this.call(
      'setSafetyVerified',
      friendId,
      safety
    ).catch(() => null);

    return row;
  }
}

export const mountCanonicalFriends = async ({
  root,
  identity = {},
  build = DEFAULT_BUILD,
  onGameInvite = null,
  onClose = null
} = {}) => {
  if (!root) throw new Error('friends_embed_root_required');

  const contextId = makeId('friends_embed');
  let webPushEnabled = false;
  let destroyed = false;

  root.classList.add('vf-app', 'gc-friends-embed');
  root.innerHTML = `
    <div class="gc-friends-loading">
      Загружаем Друзья...
    </div>
  `;

  const moduleUrl =
    `${FRIENDS_BASE}/friends-ui.js?v=${encodeURIComponent(build)}`;

  const [module, remoteIdentity, pushState] = await Promise.all([
    import(moduleUrl),
    (
      safe(identity?.friendId) && identity?.yandexLinked
        ? Promise.resolve(identity)
        : requestHost('getEmbeddedIdentity')
    ),
    requestHost('getEmbeddedWebPushEnabled')
      .catch(() => false),
    ensureStyles(build)
  ]);

  webPushEnabled = !!pushState;

  await requestHost('setEmbeddedFriendsActive', [{
    contextId,
    active: true
  }]);

  const core = new FriendsRpcCore(remoteIdentity || identity);
  root.innerHTML = '';

  const ui = module.mountFriendsUI(root, core, {
    onGameInvite,
    onEnableWebPush: async () => {
      const result = await requestHost('enableEmbeddedWebPush');
      webPushEnabled = !!result?.ok;
      return result;
    },
    getWebPushEnabled: () => webPushEnabled
  });

  await ui.refresh({ force: true });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;

    root.querySelectorAll('.vf-modal-ov')
      .forEach(node => node.remove());

    root.innerHTML = '';

    requestHost('setEmbeddedFriendsActive', [{
      contextId,
      active: false
    }]).catch(() => null);

    onClose?.();
  };

  return {
    core,
    ui,
    destroy
  };
};

export default {
  mountCanonicalFriends
};
