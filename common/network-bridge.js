/**
 * common/network-bridge.js
 * Общий WebRTC + Yandex Cloud Function signaling bridge для всех игр.
 * Используется из /Games/war_hearts/ и будущих игр.
 */

const DEFAULT_SIGNALING_URL = 'https://functions.yandexcloud.net/d4e2epg33mkshjoar6av';

const safe = v => String(v == null ? '' : v).trim();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const jsonParse = raw => {
  try { return JSON.parse(raw); } catch { return null; }
};

const makeId = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }
};

const getOrCreateIdentity = () => {
  let playerId = storage.get('vi3:games:playerId');
  let clientSecret = storage.get('vi3:games:clientSecret');

  if (!playerId) {
    playerId = makeId('plr');
    storage.set('vi3:games:playerId', playerId);
  }

  if (!clientSecret) {
    clientSecret = `${makeId('sec')}_${Math.random().toString(36).slice(2)}`;
    storage.set('vi3:games:clientSecret', clientSecret);
  }

  return { playerId, clientSecret };
};

export class NetworkBridge {
  constructor(myIdOrOptions = {}) {
    const opts = typeof myIdOrOptions === 'object' ? myIdOrOptions : { playerId: myIdOrOptions };
    const ident = getOrCreateIdentity();

    this.signalingUrl = opts.signalingUrl || DEFAULT_SIGNALING_URL;
    this.gameId = opts.gameId || 'generic';
    this.playerId = safe(opts.playerId || opts.myId || ident.playerId);
    this.clientSecret = safe(opts.clientSecret || ident.clientSecret);
    this.displayName = safe(opts.displayName || 'Игрок');

    this.roomId = '';
    this.roomSecret = '';
    this.peerId = '';
    this.remotePeerId = '';
    this.role = '';

    this.peer = null;
    this.dataChannel = null;
    this.pollTimer = 0;
    this.heartbeatTimer = 0;
    this.audioStream = null;
    this.audioSender = null;
    this.remoteAudio = null;
    this.pendingIce = [];
    this.connected = false;
    this.closed = false;

    this.onConnect = () => {};
    this.onDisconnect = () => {};
    this.onData = () => {};
    this.onChat = () => {};
    this.onStatus = () => {};
    this.onRoom = () => {};
    this.onError = () => {};
  }

  async _req(action, data = {}) {
    const res = await fetch(this.signalingUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Vi3-Player': this.playerId,
        'X-Vi3-Secret': this.clientSecret
      },
      credentials: 'omit',
      mode: 'cors',
      body: JSON.stringify({
        action,
        playerId: this.playerId,
        clientSecret: this.clientSecret,
        displayName: this.displayName,
        gameId: this.gameId,
        ...data
      })
    });

    const text = await res.text();
    const json = jsonParse(text) || {};
    if (!res.ok || json.ok === false) {
      const err = new Error(json.error || json.reason || `http_${res.status}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }

    return json;
  }

  _emitStatus(label, online = false, extra = {}) {
    this.onStatus({ label, online, ...extra });
  }

  async init() {
    await this._req('player_register', {
      displayName: this.displayName
    });
    await this.heartbeat();
    this._startHeartbeat();
    this._emitStatus('ready', false);
    return true;
  }

  async heartbeat() {
    return this._req('presence_heartbeat', {
      deviceId: 'web',
      gameId: this.gameId,
      roomId: this.roomId || ''
    });
  }

  async checkFriend(targetId) {
    const res = await this._req('friend_status_check', { targetId });
    return !!res.online;
  }

  async createFriendInvite() {
    return this._req('friend_invite_create', {
      displayName: this.displayName
    });
  }

  async acceptFriendInvite({ inviteId, secret }) {
    return this._req('friend_invite_accept', {
      inviteId,
      secret,
      displayName: this.displayName
    });
  }

  async createGameInvite(toPlayerId) {
    return this._req('game_invite_create', {
      toPlayerId,
      gameId: this.gameId
    });
  }

  async pollGameInvites() {
    return this._req('game_invite_poll', {
      gameId: this.gameId
    });
  }

  async submitMatchResult(resultData) {
    return this._req('match_submit_result', resultData);
  }

  async getLeaderboard() {
    return this._req('leaderboard_get', {});
  }

  async createRoom() {
    const hostPeerId = makeId('host');
    const res = await this._req('room_create', {
      gameId: this.gameId,
      peerId: hostPeerId
    });

    this.role = 'host';
    this.roomId = res.roomId;
    this.roomSecret = res.roomSecret;
    this.peerId = res.hostPeerId;
    this.remotePeerId = res.guestPeerId;

    this.onRoom({
      role: this.role,
      roomId: this.roomId,
      roomSecret: this.roomSecret,
      joinUrl: this.buildJoinUrl()
    });

    return {
      ...res,
      joinUrl: this.buildJoinUrl()
    };
  }

  async joinRoom({ roomId, roomSecret }) {
    const res = await this._req('room_join', {
      roomId,
      roomSecret
    });

    this.role = 'guest';
    this.roomId = res.roomId;
    this.roomSecret = roomSecret;
    this.peerId = res.guestPeerId;
    this.remotePeerId = res.hostPeerId;

    this.onRoom({
      role: this.role,
      roomId: this.roomId,
      roomSecret: this.roomSecret
    });

    return res;
  }

  buildJoinUrl() {
    const u = new URL('/Games/', window.location.href);
    u.searchParams.set('gcGame', this.gameId);
    u.searchParams.set('room', this.roomId);
    u.searchParams.set('key', this.roomSecret);
    return u.toString();
  }

  _initPeer() {
    this.peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
      ],
      iceCandidatePoolSize: 4
    });

    try {
      const transceiver = this.peer.addTransceiver('audio', {
        direction: 'sendrecv'
      });
      this.audioSender = transceiver.sender;
    } catch {
      this.audioSender = null;
    }

    this.peer.onicecandidate = e => {
      if (!e.candidate || !this.roomId || !this.remotePeerId) return;
      this._sendSignal('ice', e.candidate).catch(err => this.onError(err));
    };

    this.peer.onconnectionstatechange = () => {
      const st = this.peer?.connectionState || 'unknown';
      if (st === 'connected') {
        this.connected = true;
        this._emitStatus('online', true);
      }
      if (['disconnected', 'failed', 'closed'].includes(st)) {
        this.connected = false;
        this._emitStatus(st, false);
        this.onDisconnect({ state: st });
      }
    };

    this.peer.ondatachannel = e => {
      this._bindDataChannel(e.channel);
    };

    this.peer.ontrack = e => {
      this._attachRemoteAudio(e.streams?.[0]);
    };

    this.peer.onnegotiationneeded = async () => {
      if (this.closed || !this.peer || !this.remotePeerId || this.role !== 'host') return;
      if (!this.connected) return; // Предотвращаем WebRTC glare: Хост не отправляет оффер до установки P2P соединения
      try {
        await this._makeAndSendOffer('renegotiate');
      } catch (err) {
        this.onError(err);
      }
    };
  }

  _bindDataChannel(channel) {
    this.dataChannel = channel;
    this.dataChannel.onopen = () => {
      this.connected = true;
      this._emitStatus('online', true);
      this.onConnect({
        roomId: this.roomId,
        role: this.role
      });
    };
    this.dataChannel.onclose = () => {
      this.connected = false;
      this.onDisconnect({ state: 'datachannel_closed' });
    };
    this.dataChannel.onmessage = e => {
      const data = jsonParse(e.data);
      if (!data) return;
      if (data.type === 'CHAT_MESSAGE') this.onChat(data);
      this.onData(data);
    };
  }

  _attachRemoteAudio(stream) {
    if (!stream) return;
    let audio = document.getElementById('remote-voice');
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'remote-voice';
      audio.autoplay = true;
      audio.playsInline = true;
      audio.style.display = 'none';
      document.body.appendChild(audio);
    }
    audio.srcObject = stream;
    this.remoteAudio = audio;
  }

  async _sendSignal(type, data) {
    return this._req('signal_send', {
      roomId: this.roomId,
      roomSecret: this.roomSecret,
      fromPeerId: this.peerId,
      toPeerId: this.remotePeerId,
      type,
      payload: { type, data }
    });
  }

  async _makeAndSendOffer(reason = 'offer') {
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    await this._sendSignal('offer', {
      sdp: this.peer.localDescription,
      reason
    });
  }

  async _handleSignal(msg) {
    const type = msg.type || msg.payload?.type;
    const data = msg.data || msg.payload?.data;

    if (!this.peer) return;

    if (type === 'offer') {
      const desc = data?.sdp || data;
      await this.peer.setRemoteDescription(new RTCSessionDescription(desc));

      for (const c of this.pendingIce.splice(0)) {
        await this.peer.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }

      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);
      await this._sendSignal('answer', this.peer.localDescription);
      return;
    }

    if (type === 'answer') {
      const desc = data?.sdp || data;
      if (this.peer.signalingState !== 'stable') {
        await this.peer.setRemoteDescription(new RTCSessionDescription(desc));
      }

      for (const c of this.pendingIce.splice(0)) {
        await this.peer.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      return;
    }

    if (type === 'ice') {
      if (!this.peer.remoteDescription) {
        this.pendingIce.push(data);
        return;
      }
      await this.peer.addIceCandidate(new RTCIceCandidate(data)).catch(() => {});
    }
  }

  _startPolling(intervalMs = 800) {
    this.stopPolling();

    this.pollTimer = setInterval(async () => {
      if (this.closed || !this.roomId || !this.peerId) return;
      try {
        const res = await this._req('signal_poll', {
          roomId: this.roomId,
          roomSecret: this.roomSecret,
          peerId: this.peerId
        });

        for (const msg of res.messages || []) {
          await this._handleSignal(msg);
        }
      } catch (err) {
        this.stopPolling();
        this.onError(err);
      }
    }, intervalMs);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = 0;
  }

  _startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (!document.hidden) {
        this.heartbeat().catch((err) => {
          if (err && err.status >= 500) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = 0;
            this.onError(err);
          }
        });
      }
    }, 25000);
  }

  async connectAsHost() {
    if (!this.roomId) await this.createRoom();

    this.role = 'host';
    this._initPeer();

    // В serverless-архитектуре хост просто ждет оффера от гостя
    this._startPolling(800);
    this._emitStatus('waiting', false);

    return {
      roomId: this.roomId,
      roomSecret: this.roomSecret,
      joinUrl: this.buildJoinUrl()
    };
  }

  async connectAsGuest({ roomId, roomSecret }) {
    await this.joinRoom({ roomId, roomSecret });

    this.role = 'guest';
    this._initPeer();
    
    // Гость создает канал и ПЕРВЫМ отправляет WebRTC Offer хосту
    const ch = this.peer.createDataChannel('game', {
      ordered: true
    });
    this._bindDataChannel(ch);
    await this._makeAndSendOffer('initial');

    this._startPolling(800);
    this._emitStatus('connecting', false);

    return true;
  }

  async connectFromUrl() {
    const u = new URL(window.location.href);
    const roomId = u.searchParams.get('room');
    const roomSecret = u.searchParams.get('key') || u.searchParams.get('secret');
    if (!roomId || !roomSecret) return false;
    await this.connectAsGuest({ roomId, roomSecret });
    return true;
  }

  send(data) {
    if (this.dataChannel?.readyState !== 'open') return false;
    this.dataChannel.send(JSON.stringify(data));
    return true;
  }

  sendChat(text, from = this.displayName) {
    return this.send({
      type: 'CHAT_MESSAGE',
      payload: {
        from,
        text: safe(text).slice(0, 300)
      },
      at: Date.now()
    });
  }

  async toggleVoice(enable) {
    if (!this.peer) return false;

    if (!this.audioStream) {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const track = this.audioStream.getAudioTracks()[0];
      if (track) {
        track.enabled = false;
        if (this.audioSender?.replaceTrack) {
          await this.audioSender.replaceTrack(track);
        } else {
          this.peer.addTrack(track, this.audioStream);
        }
      }
    }

    const track = this.audioStream.getAudioTracks()[0];
    if (track) track.enabled = !!enable;

    try {
      await this.remoteAudio?.play?.();
    } catch {}

    this.send({
      type: 'VOICE_STATE',
      payload: { active: !!enable },
      at: Date.now()
    });

    return true;
  }

  async close() {
    this.closed = true;
    this.stopPolling();

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = 0;

    try {
      await this._req('room_close', {
        roomId: this.roomId,
        roomSecret: this.roomSecret
      });
    } catch {}

    try { this.dataChannel?.close?.(); } catch {}
    try { this.peer?.close?.(); } catch {}

    this.audioStream?.getTracks?.().forEach(t => {
      try { t.stop(); } catch {}
    });

    this.peer = null;
    this.dataChannel = null;
    this.audioStream = null;
    this.connected = false;
  }
}

export default NetworkBridge;
