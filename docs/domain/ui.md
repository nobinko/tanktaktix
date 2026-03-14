# UI / デザイン

対象コード:

- `client/src/render/`
- `client/src/ui/`
- `client/src/audio/SoundManager.ts`
- `client/src/style.css`

## 描画レイヤ

### world

本編の地形とエンティティを描きます。

主な担当:

- `client/src/render/world.ts`
- `client/src/render/entities.ts`
- `client/src/render/effects.ts`
- `client/src/render/terrain.ts`

### HUD

- HP
- ammo
- item
- minimap
- chat
- score

主な担当:

- `client/src/render/hud.ts`

### DOM UI

- lobby
- room create/join
- modal
- map editor

主な担当:

- `client/src/ui/dom.ts`
- `client/src/ui/modal.ts`
- `client/src/ui/mapEditor.ts`

## 地形描画の現仕様

2026-03 時点で、本編の地形描画は expanded `Wall[]` だけを前提にしていません。

- `client/src/net/handlers.ts` が `roomInit.mapData` から `state.mapGeometry` を生成
- `client/src/render/world.ts` が `state.mapGeometry.renderables` を描画
- `client/src/render/terrain.ts` が runtime shape ごとの描画を担当

## river elbow

river elbow は本編でも Canvas `arc()` を使って描画します。

つまり:

- editor だけ綺麗、ではない
- title 背景、ルームサムネイル、ミニマップでも同じ geometry を再利用する

## minimap / title / thumbnail

同じ runtime geometry を別 UI でも使います。

- minimap: `client/src/render/hud.ts`
- title background: `client/src/render/titleRenderer.ts`
- room thumbnail: `client/src/ui/dom.ts`

これにより、曲線地形の見た目が画面ごとにずれません。

## map editor

map editor は `MapData` を編集します。

主要機能:

- 壁配置
- prefab 配置
- spawn point 配置
- flag 配置
- item 配置
- JSON import/export
- play test

重要仕様:

- 旗を置かないなら `flagPositions` を出さない
- river elbow prefab は editor 上でも本編でも曲線として見える

## UI 確認項目

地形や editor を触ったらここを見る:

- world で river elbow が滑らか
- minimap でも同じ形に見える
- room thumbnail でも角ばらない
- flag 未配置マップで旗 UI が変に出ない
