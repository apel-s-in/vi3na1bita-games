/**
 * /Games/common/friends-embed.js
 * Канонический /Friends/friends-ui.js внутри sandbox iframe.
 * Все data/E2EE операции выполняются основным приложением через RPC.
 */

const FRIENDS_BASE =
  'https://vi3na1bita.website.yandexcloud.net/Friends';
const DEFAULT_BUILD = '8.9.2';
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

  window.parent.postMessage({
    kind: 'vitrina:game',
    bridgeId,
    type,
    payload
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
  if (document.getElementById(id)) return;

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href =
    `${FRIENDS_BASE}/styles.css?v=${encodeURIComponent(build)}`;
  document.head.appendChild(link);
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

  register() {
    return this.call('register');
  }

  getFriendList(options) {
    return this.call('getFriendList', options);
  }

  getPresence(friendIds) {
    return this.call('getPresence', friendIds);
  }

  getProfile(friendId) {
    return this.call('getProfile', friendId);
  }

  removeFriend(friendId) {
    return this.call('removeFriend', friendId);
  }

  createInvite() {
    return this.call('createInvite');
  }

  acceptInvite(data) {
    return this.call('acceptInvite', data);
  }

  createNearbyFriendCode() {
    return this.call('createNearbyFriendCode');
  }

  joinNearbyFriendCode(code) {
    return this.call('joinNearbyFriendCode', code);
  }

  sendPush(data) {
    return this.call('sendPush', data);
  }

  sendChatMessage(data) {
    return this.call('sendChatMessage', data);
  }

  reactChatMessage(data) {
    return this.call('reactChatMessage', data);
  }

  deleteChatMessage(data) {
    return this.call('deleteChatMessage', data);
  }

  getChatMessages(data) {
    return this.call('getChatMessages', data);
  }

  getChatMessage(data) {
    return this.call('getChatMessage', data);
  }

  clearChat(friendId) {
    return this.call('clearChat', friendId);
  }

  getChatSettings(friendId) {
    return this.call('getChatSettings', friendId);
  }

  setChatRetention(friendId, days) {
    return this.call('setChatRetention', friendId, days);
  }

  purgeChatForBoth(friendId) {
    return this.call('purgeChatForBoth', friendId);
  }

  markChatDelivered(data) {
    return this.call('markChatDelivered', data);
  }

  markChatRead(data) {
    return this.call('markChatRead', data);
  }

  getOwnCryptoDevices() {
    return this.call('getOwnCryptoDevices');
  }

  getCryptoDevices(friendId) {
    return this.call('getCryptoDevices', friendId);
  }

  getLocalCryptoDevice() {
    return this.call('getLocalCryptoDevice');
  }

  revokeCryptoDevice(deviceId) {
    return this.call('revokeCryptoDevice', deviceId);
  }

  resetCryptoDevices() {
    return this.call('resetCryptoDevices');
  }

  getSafetyNumber(friendId) {
    return this.call('getSafetyNumber', friendId);
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

  getRtcConfig() {
    return this.call('getRtcConfig');
  }

  getVoiceHistory(friendId) {
    return this.call('getVoiceHistory', friendId);
  }

  createVoiceCall(data) {
    return this.call('createVoiceCall', data);
  }

  joinVoiceCall(data) {
    return this.call('joinVoiceCall', data);
  }

  endVoiceCall(data) {
    return this.call('endVoiceCall', data);
  }

  getRoom(roomId, roomSecret) {
    return this.call('getRoom', roomId, roomSecret);
  }

  sendVoiceSignal(data) {
    return this.call('sendVoiceSignal', data);
  }

  pollVoiceSignals(data) {
    return this.call('pollVoiceSignals', data);
  }

  ackVoiceSignals(data) {
    return this.call('ackVoiceSignals', data);
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

  ensureStyles(build);

  root.classList.add('vf-app', 'gc-friends-embed');
  root.innerHTML = `
    <div class="gc-friends-loading">
      Загружаем Друзья...
    </div>
  `;

  const module = await import(
    `${FRIENDS_BASE}/friends-ui.js?v=${encodeURIComponent(build)}`
  );

  const core = new FriendsRpcCore(identity);

  root.innerHTML = '';

  const ui = module.mountFriendsUI(root, core, {
    onGameInvite,
    onEnableWebPush: null,
    getWebPushEnabled: () => false
  });

  await ui.refresh({ force: true });

  return {
    core,
    ui,
    destroy() {
      root.querySelectorAll('.vf-modal-ov')
        .forEach(node => node.remove());
      root.innerHTML = '';
      onClose?.();
    }
  };
};

export default {
  mountCanonicalFriends
};
