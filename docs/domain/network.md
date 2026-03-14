# ネットワーク

対象コード:

- `shared/src/index.ts`
- `server/src/network/handlers.ts`
- `server/src/network/broadcast.ts`
- `client/src/net/wsClient.ts`
- `client/src/net/handlers.ts`

## 形式

- WebSocket endpoint: `/ws`
- フレーム形式: JSON
- 形: `{ type, payload }`

共通型の正本は `shared/src/index.ts` です。

## 主要メッセージ

### client -> server

- `login`
- `requestLobby`
- `switchLobby`
- `createRoom`
- `joinRoom`
- `spectateRoom`
- `selectTeam`
- `leaveRoom`
- `move`
- `moveCancelOne`
- `stopMove`
- `aim`
- `shoot`
- `useItem`
- `chat`
- `ping`
- `reportPing`

### server -> client

- `welcome`
- `lobby`
- `roomInit`
- `room`
- `explosion`
- `chat`
- `gameEnd`
- `leaderboard`
- `error`
- `pong`

## `roomInit` と map data

重要:

- `roomInit.mapData` は raw `MapData` です。
- server は compiled geometry をそのまま wire に流していません。
- client は `roomInit.mapData` を受け取ってローカルで `compileMapGeometry(mapData)` を実行します。

この構成の理由:

- wire format を既存 `MapData` のまま保てる
- runtime-only shape を追加しやすい
- client と server が同じ shared compiler を使える

## tick メッセージ

通常の `room` メッセージは 20Hz で流れますが、地形 geometry を毎 tick で送り直す前提ではありません。

- map は init-time data
- プレイ中に必要なのは player, projectile, item, score, flags などの更新

## createRoom と custom map

custom map は `createRoom.payload.customMapData` に `MapData` を載せる形です。

server 側では:

1. `customMapData` を受け取る
2. raw `MapData` として room に保持する
3. 同時に `compileMapGeometry()` で runtime geometry を生成する

## 地形変更時の注意

地形 shape を追加するときは network protocol を先に変える必要はありません。まず `MapData` で表現できるか、もしくは prefab + compiler で runtime shape に落とせるかを確認します。

現行ではこの方針です。

- 保存・通信: `MapData`
- 実行時: `RuntimeMapGeometry`
