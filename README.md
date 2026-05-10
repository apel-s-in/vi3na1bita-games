# vi3na1bita-games

Isolated Game Center micro-app for `vi3na1bita-music`.

Important:
- repository root is deployed into Yandex Object Storage prefix `/Games/`;
- do not create a root `Games/` folder inside this repo;
- no audio, no WebAudio, no direct access to parent app storage;
- communication with main app only through `postMessage` bridge.
