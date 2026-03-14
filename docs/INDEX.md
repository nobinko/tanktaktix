# ドキュメント索引

Tank Taktix の現行仕様を追うための入口です。

## 優先して読むファイル

- `docs/ARCHITECTURE.md`: 全体構成
- `docs/domain/maps.md`: マップ、prefab、runtime geometry、CTF flag
- `docs/domain/network.md`: WebSocket と `roomInit.mapData`
- `docs/domain/ui.md`: world renderer と map editor
- `docs/test/README.md`: 検証スクリプト

## ドメイン別

- `docs/domain/combat.md`
- `docs/domain/items.md`
- `docs/domain/maps.md`
- `docs/domain/movement.md`
- `docs/domain/network.md`
- `docs/domain/session.md`
- `docs/domain/ui.md`

## 補助資料

- `docs/ACCEPTANCE.md`
- `docs/CONTRIBUTING.md`
- `docs/ROADMAP.md`
- `docs/decisions.md`
- `docs/inbox.md`

## 2026-03 の重要変更

- map runtime は `compileMapGeometry()` を正本にする
- river elbow は本編でも collision でも曲線扱い
- `flagPositions` 未指定時に flag を自動生成しない
- `roomInit.mapData` は raw `MapData` のまま送る
