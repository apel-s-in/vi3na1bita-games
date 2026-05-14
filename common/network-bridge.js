/**
 * @file common/network-bridge.js
 * Универсальный WebRTC/Signaling адаптер для игр.
 */
export class NetworkBridge {
  constructor(myId) {
    this.signalingUrl = 'https://functions.yandexcloud.net/d4e2epg33mkshjoar6av';
    this.myId = myId;
    this.targetId = null;
    this.peer = null;
    this.dataChannel = null;
    this.pollTimer = null;
    this.audioStream = null;
    
    // Коллбэки для игры
    this.onConnect = () => {};
    this.onData = () => {};
  }

  async _req(action, data = {}) {
    const res = await fetch(this.signalingUrl, {
      method: 'POST',
      body: JSON.stringify({ action, userId: this.myId, ...data })
    });
    return res.json();
  }

  // Принудительная проверка онлайна друга
  async checkFriend(targetId) {
    const res = await this._req('check_status', { targetId });
    return res.online;
  }

  _initPeer() {
    this.peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    
    // Канал данных (координаты, чат)
    this.dataChannel = this.peer.createDataChannel('game', { negotiated: true, id: 0 });
    this.dataChannel.onopen = () => this.onConnect();
    this.dataChannel.onmessage = e => this.onData(JSON.parse(e.data));

    // Голосовой поток от друга
    this.peer.ontrack = e => {
      let audio = document.getElementById('remote-voice');
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'remote-voice';
        audio.autoplay = true;
        document.body.appendChild(audio);
      }
      audio.srcObject = e.streams[0];
    };

    this.peer.onicecandidate = e => {
      if (e.candidate && this.targetId) {
        this._req('send_signal', { targetId: this.targetId, payload: { type: 'ice', data: e.candidate } });
      }
    };
  }

  // Создать комнату
  async hostGame() {
    this._initPeer();
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    this._startPolling();
    return offer; // Оффер нужно будет передать другу через QR/Ссылку
  }

  // Присоединиться к другу
  async joinGame(targetId, offer) {
    this.targetId = targetId;
    this._initPeer();
    await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    await this._req('send_signal', { targetId, payload: { type: 'answer', data: answer } });
    this._startPolling();
  }

  // Отправка хода или сообщения чата
  send(data) {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(data));
    }
  }

  // Микрофон: Запрашиваем строго по клику в игре!
  async toggleVoice(enable) {
    if (enable) {
      if (!this.audioStream) {
        this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        this.audioStream.getTracks().forEach(t => this.peer.addTrack(t, this.audioStream));
      } else {
        this.audioStream.getAudioTracks().forEach(t => t.enabled = true);
      }
    } else if (this.audioStream) {
      this.audioStream.getAudioTracks().forEach(t => t.enabled = false);
    }
  }

  _startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      const res = await this._req('poll_signals');
      for (const msg of (res.messages || [])) {
        if (msg.payload.type === 'answer') {
          this.targetId = msg.from;
          await this.peer.setRemoteDescription(new RTCSessionDescription(msg.payload.data));
        } else if (msg.payload.type === 'ice') {
          await this.peer.addIceCandidate(new RTCIceCandidate(msg.payload.data));
        }
      }
    }, 2500);
  }
}
