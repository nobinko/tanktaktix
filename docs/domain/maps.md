# マップ

対象コード:

- `shared/src/maps.ts`
- `shared/src/prefabs.ts`
- `shared/src/geometry.ts`
- `server/src/room.ts`
- `server/src/utils/collision.ts`
- `client/src/render/world.ts`
- `client/src/render/terrain.ts`
- `client/src/ui/mapEditor.ts`

## 基本方針

マップは 2 層あります。

1. 保存・通信用の `MapData`
2. 実行用の `RuntimeMapGeometry`

`MapData` は editor、JSON export/import、network payload のための形式です。ゲーム本編は `compileMapGeometry(mapData)` が作る runtime geometry を使います。

## `MapData`

代表的な形:

```ts
type MapData = {
  id: string;
  width: number;
  height: number;
  walls: Wall[];
  objects?: MapObject[];
  spawnPoints: { team: Team; x: number; y: number; radius?: number }[];
  flagPositions?: { team: Team; x: number; y: number }[];
  itemMode?: "random" | "manual";
  itemSpawns?: { x: number; y: number; type: ItemType }[];
};
```

### フィールド要点

- `walls`: 直線地形や単純地形
- `objects`: prefab 配置
- `spawnPoints`: チームごとのスポーン地点
- `flagPositions`: CTF の旗位置
- `itemMode` / `itemSpawns`: アイテム配置制御

## CTF フラグの現仕様

重要:

- `flagPositions` があるときだけ旗が出ます。
- `flagPositions` を省略しても `spawnPoints` から旗は作られません。

旧仕様の「`flagPositions` 省略時はスポーン中心に旗を置く」は廃止済みです。

## prefab

代表的な prefab:

- house 系
- base 系
- straight river 系
- `river-elbow-gentle-*`
- `river-elbow-mid-*`
- `river-elbow-sharp-*`
- bridge 系
- `oneway`
- `bush`

`MapObject` は配置情報だけを持ちます。

```ts
type MapObject = {
  type: PrefabType;
  x: number;
  y: number;
  rotation?: number;
};
```

## ランタイム geometry

`compileMapGeometry(mapData)` が `RuntimeMapGeometry` を返します。

現行 shape:

- `rect`
- `ringSector`

### shape の対応

| shape | 用途 |
|---|---|
| `rect` | wall, bush, water, house, oneway, bridge, straight river |
| `ringSector` | river elbow |

## river elbow

### 現在の挙動

- editor では曲線表示
- client 本編でも曲線表示
- server collision でも曲線判定

### つまり何が変わったか

以前:

- editor だけ滑らか
- 本編は矩形分割
- 衝突も矩形分割ベース

現在:

- runtime で `ringSector` を使う
- 見た目と衝突の両方が曲線ベース

## `expandMapObjects()` の扱い

`expandMapObjects()` は残っていますが、river elbow の authoritative runtime path ではありません。

現在の位置づけ:

- editor 内の補助
- export 互換
- rectangle-only の補助処理

本編 gameplay は `compileMapGeometry()` を基準にしてください。

## server 側の使い方

- `createRoom()` が raw `MapData` を保持
- 同時に `Room.geometry` をコンパイル
- 移動判定、弾判定、茂み判定、スポーン確認が `Room.geometry` を参照

## client 側の使い方

- `roomInit.mapData` を受信
- `compileMapGeometry(mapData)` を 1 回だけ実行
- `state.mapGeometry` に保持
- world / minimap / title / room thumbnail で再利用

## custom map JSON

map editor の `EXPORT JSON` と `Custom Map (Paste JSON)` は `MapData` をやり取りします。

最小例:

```json
{
  "id": "my-map",
  "width": 1600,
  "height": 1200,
  "walls": [
    { "x": 760, "y": 0, "width": 80, "height": 350, "type": "river" }
  ],
  "objects": [
    { "type": "river-elbow-mid-s", "x": 800, "y": 350, "rotation": 0 }
  ],
  "spawnPoints": [
    { "team": "red", "x": 150, "y": 600, "radius": 120 },
    { "team": "blue", "x": 1450, "y": 600, "radius": 120 }
  ]
}
```

この例では `flagPositions` がないので旗は出ません。

## 確認ポイント

map 周りを触ったら最低限これを確認します。

- river elbow が本編で滑らかに見える
- タンクが elbow の曲線縁に沿って止まる
- 弾が曲線地形で止まる
- `flagPositions` 未指定マップで旗が出ない
