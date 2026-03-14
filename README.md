# Tank Taktix

Canvas 2D の見下ろし型タンクゲームです。モノレポ構成で、`client` が描画と UI、`server` が 20Hz のゲーム進行、`shared` が共通型とマップ定義を持ちます。

## 開発

```powershell
npm install
npm run dev
```

- client: `http://localhost:5173`
- server: `http://localhost:3000`
- health: `http://localhost:3000/health`

## 本番ビルド

```powershell
npm install
npm run build
npm run start
```

## ランタイム地形の現仕様

2026-03 時点で、マップの保存形式とゲーム内の地形処理は分離されています。

- 保存と通信は `MapData` を使います。
- `MapData` には `walls` と、必要に応じて prefab `objects` を含められます。
- 実行時は `@tanktaktix/shared` の `compileMapGeometry(mapData)` が `RuntimeMapGeometry` を生成します。
- 現在の地形プリミティブは `rect` と `ringSector` です。
- river elbow prefab は runtime で `ringSector` になり、見た目も衝突も曲線として扱われます。
- server は room ごとに geometry を一度だけコンパイルし、移動・弾・茂み・スポーン安全確認に使います。
- client は `roomInit.mapData` を受け取って同じ geometry をローカルでコンパイルし、ワールド描画・ミニマップ・タイトル背景・ルームサムネイルに再利用します。

## CTF フラグの現仕様

- `flagPositions` を指定したときだけ旗が出ます。
- `flagPositions` を省略しても `spawnPoints` から旗は自動生成されません。
- 旗なしマップを map editor からそのまま作れます。

## 主要ファイル

- `shared/src/index.ts`: 共通型とメッセージ型
- `shared/src/maps.ts`: 既定マップ
- `shared/src/prefabs.ts`: prefab 定義
- `shared/src/geometry.ts`: runtime 地形コンパイラ
- `server/src/room.ts`: room 生成と geometry 準備
- `server/src/utils/collision.ts`: runtime geometry ベースの衝突判定
- `client/src/render/world.ts`: 本編ワールド描画
- `client/src/render/terrain.ts`: runtime 地形描画
- `client/src/ui/mapEditor.ts`: map editor

## ドキュメント

- `docs/INDEX.md`: 全体案内
- `docs/ARCHITECTURE.md`: システム構成
- `docs/domain/maps.md`: マップ、prefab、runtime geometry
- `docs/domain/network.md`: 通信と payload
- `docs/domain/ui.md`: 描画と UI
- `docs/test/README.md`: 検証スクリプト
