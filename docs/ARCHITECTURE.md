# アーキテクチャ

Tank Taktix は `client` / `server` / `shared` の 3 パッケージで構成されています。

## パッケージごとの責務

### `shared`

- 共通型
- WebSocket メッセージ型
- マップ定義
- prefab 定義
- ランタイム地形コンパイル

主なファイル:

- `shared/src/index.ts`
- `shared/src/maps.ts`
- `shared/src/prefabs.ts`
- `shared/src/geometry.ts`

### `server`

- Express + WebSocket サーバ
- 20Hz のゲーム tick
- room と lobby の管理
- 移動、弾、CTF、アイテムの進行
- runtime geometry ベースの衝突判定

主なファイル:

- `server/src/index.ts`
- `server/src/room.ts`
- `server/src/tick.ts`
- `server/src/utils/collision.ts`
- `server/src/systems/projectiles.ts`

### `client`

- Canvas 2D による描画
- DOM UI
- 入力
- WebSocket クライアント
- room init 時の runtime geometry コンパイル

主なファイル:

- `client/src/main.ts`
- `client/src/state.ts`
- `client/src/net/handlers.ts`
- `client/src/render/world.ts`
- `client/src/render/terrain.ts`
- `client/src/ui/mapEditor.ts`

## 実行時フロー

1. server が `roomInit` で raw `MapData` を送る
2. client が `compileMapGeometry(mapData)` を実行して `state.mapGeometry` を作る
3. world renderer / minimap / thumbnails / title background が `mapGeometry.renderables` を描く
4. server は `Room.geometry` を使って移動、弾、スポーン安全確認、茂み判定を行う

## マップ表現

### 保存・通信

保存形式と通信 payload は `MapData` が正本です。

- `walls`
- `objects?`
- `spawnPoints`
- `flagPositions?`
- `itemMode?`
- `itemSpawns?`

既存マップ互換を壊さないため、wire format はこのまま維持しています。

### ランタイム

ゲーム内では `RuntimeMapGeometry` を使います。

現行 shape:

- `rect`
- `ringSector`

現在の用途:

- `rect`: wall / bush / water / house / oneway / bridge / straight river
- `ringSector`: river elbow prefab

## river elbow の扱い

以前は river elbow を複数の回転矩形に展開して本編に使っていました。現在は以下に統一されています。

- editor: 曲線表示
- client 本編: 曲線表示
- server collision: 曲線判定

つまり、river elbow は「見た目だけ曲線」ではありません。

## `expandMapObjects()` の位置づけ

`expandMapObjects()` は残っていますが、曲線地形の authoritative runtime path ではありません。

現在の位置づけ:

- editor や export 互換用の矩形展開
- legacy な rectangle-only 処理の補助

server の gameplay collision と client の本編描画は `compileMapGeometry()` 側を正本とします。

## CTF フラグ

- `flagPositions` があるときだけ flag を生成します。
- `flagPositions` 未指定時に `spawnPoints` から旗を補完する挙動は廃止済みです。

## 検証

関連変更時は最低限これを通します。

```powershell
npm run build -w shared
npm run build -w server
npm run build -w client
npx tsx tasks/verify_geometry_runtime.ts
```
