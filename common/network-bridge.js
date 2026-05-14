/**
 * @module NetworkBridge (WebRTC + Signaling)
 * Универсальное P2P-ядро для всех игр vi3na1bita.
 */
export class NetworkBridge {
  constructor(signalingUrl, myId) {
    this.signalingUrl = signalingUrl;
    this.myId = myId;
    this.peerConnection = null;
    this.dataChannel = null;
    this.onMessage = null; // Коллбэк для игры
    this.onConnect = null;
    this.pollInterval = null;
  }

  async _request(action, data = {}) {
    const res = await fetch(this.signalingUrl, {
      method: 'POST',
      body: JSON.stringify({ action, userId: this.myId, ...data })
    });
    return res.json();
  }

  // Принудительная проверка друга (для вкладки "Друзья")
  async checkFriendStatus(friendId) {
    const res = await this._request('check_status', { targetId: friendId });
    return res.online;
  }

  // Инициализация WebRTC (создание лобби)
  async hostGame() {
    this._createPeer();
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    // Начинаем слушать ответы
    this.startPolling(); 
    return offer; // Этот оффер упаковываем в QR/Ссылку
  }

  // Подключение к лобби друга
  async joinGame(friendId, offerPayload) {
    this._createPeer();
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offerPayload));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    
    // Отправляем ответ другу через сигнальный сервер
    await this._request('send_signal', { targetId: friendId, payload: { type: 'answer', data: answer } });
  }

  _createPeer() {
    this.peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    
    // Канал для игровых данных (координаты, выстрелы)
    this.dataChannel = this.peerConnection.createDataChannel('game_data');
    this.dataChannel.onopen = () => { if (this.onConnect) this.onConnect(); };
    this.dataChannel.onmessage = (e) => { if (this.onMessage) this.onMessage(JSON.parse(e.data)); };

    // Привязываем получение данных от друга
    this.peerConnection.ondatachannel = (e) => {
      e.channel.onmessage = (msg) => { if (this.onMessage) this.onMessage(JSON.parse(msg.data)); };
    };

    // Обмен ICE кандидатами (сетевыми путями)
    this.peerConnection.onicecandidate = (e) => {
      if (e.candidate && this.targetId) {
        this._request('send_signal', { targetId: this.targetId, payload: { type: 'ice', data: e.candidate } });
      }
    };
  }

  // В игре: вызов для отправки хода
  send(action, payload) {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify({ action, payload }));
    }
  }

  startPolling() {
    this.pollInterval = setInterval(async () => {
      const res = await this._request('poll_signals');
      if (res.messages) {
        for (const msg of res.messages) {
          if (msg.payload.type === 'answer') {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.payload.data));
            this.targetId = msg.from; // Фиксируем с кем играем
          } else if (msg.payload.type === 'ice') {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.payload.data));
          }
        }
      }
    }, 3000); // Опрос каждые 3 секунды во время коннекта
  }

  stopPolling() { clearInterval(this.pollInterval); }
}
