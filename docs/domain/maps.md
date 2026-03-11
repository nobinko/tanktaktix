# Maps

> 対応コード: `shared/src/maps.ts`, `shared/src/prefabs.ts`, `server/src/utils/collision.ts`, `client/src/render/world.ts`, `client/src/ui/mapEditor.ts`
> コードと本ドキュメントに乖離がある場合はコードを優先すること。

---

## 基本パラメータ

| パラメータ | 値 | 定数名 | 定義元 |
|---|---|---|---|
| Canvas サイズ | 1200×675 px（16:9） | — | renderer.ts |
| サーバ tick | 50 ms（20Hz） | `TICK_MS` | constants.ts |
| タンクサイズ（衝突円） | 半径 18 px | `TANK_SIZE` | constants.ts |
| タンクサイズ（回転矩形） | 26×20 px | — | constants.ts |

マップごとのワールドサイズは下記マップ一覧を参照。

---

## マップ一覧

| マップID | ワールドサイズ | レイアウト | 特徴 |
|---|---|---|---|
| **riverside** | 1600×1200 px | 川戦場 | 中央を縦断する川と2本の橋。橋付近ブッシュ、斜めワンウェイ |
| **fortress** | 1800×1200 px | 二つの砦 | 4隅水場、中央アイランド、各チーム2拠点ベース構造、ワンウェイ |

全マップは点対称設計。設計原則は `docs/inbox.md` の「マップ設計のノウハウ」を参照。

---

## 地形タイプ

| タイプ | 通行 | 弾丸 | 特殊効果 |
|---|---|---|---|
| **wall** | 不可 | 遮断（爆発） | なし |
| **bush** | 可 | 貫通 | 内部のプレイヤーを隠密状態にする |
| **water** | 不可 | 貫通 | なし |
| **house** | 不可 | 遮断（爆発） | 建物型の外観 |
| **oneway** | 不可 | 条件付き透過 | 指定方向の弾だけ透過、逆方向の弾は遮断。`rotation` で斜め配置可 |
| **river** | 不可 | 貫通 | 水色の川描画。`rotation` で斜め配置可 |
| **bridge** | 可 (`passable: true`) | 貫通 | メタリック調の橋描画。リバー上を不透明に上書き |

---

## 隠密（B-5）

- bush 内にいるプレイヤーは `isHidden = true` となる
- 隠密中は**敵チームに座標が送信されない**（ミニマップにも映らない）
- **bush 内で射撃しても隠密は解除されない**（bush 外に出た瞬間に `isHidden = false`）
- 味方チームには常に可視
- 観戦者には全プレイヤーが可視（隠密フィルタなし）

### 隠密フィルタリング

- サーバ側で `broadcast.ts` が敵チームへの `RoomState` 送信時に隠密プレイヤーをフィルタリング
- 観戦者向け送信にはフィルタを適用しない

---

## CTF フラッグ詳細

- 各チームの陣地にフラッグ（旗）が配置される（**1チーム複数本可**）
- 初期位置: `MapData.flagPositions`（省略時は `spawnPoints` を使用）
- （参考）リスポーン時の密集スタックを防ぐため、`spawnPoints` には `radius`（半径）を設定可能になっており、その領域内でランダムに分散して湧く仕様です。
- 各フラッグは `baseX`/`baseY` で固有の元位置を保持し、リセット時にその位置に戻る
- 旗の数はセオリー上 **各2〜3本** が理想（戦略分散と集中のバランス）

### フラッグルール

| アクション | 結果 |
|---|---|
| 敵旗の位置に接触 | 旗を取得（キャリア状態）。頭上に 🚩 アイコン表示 |
| 自陣スポーンゾーン内で完全停止 | チームスコア +5 / 個人スコア +5 / 旗リセット |
| キャリアが被弾（致死でなくても） | 旗をドロップ → ベース位置に即時リセット |
| キャリアが死亡 | 旗をドロップ → ベース位置に即時リセット |
| ロープ弾が旗キャリアに命中 | 旗を回収（味方からも奪取可能） |
| AIM+F | 旗をパス弾として射出、味方がキャッチ可能 |

### 「完全停止」ルール

自陣の**スポーンゾーン（スポーン地点を中心とした 200×200 の矩形エリア）**内で `isMoving === false && isRotating === false` になった瞬間にスコアが加算される。

- 旗を持って自陣に戻っただけではスコアにならない
- 立ち止まりでは旗を再取得しない（`droppedById` による即再拾得防止）

### ミニマップ表示

- 旗はミニマップ上に赤/青の円として表示される

---

## カスタムマップ（JSON インポート）

部屋作成モーダルでマップセレクトを **「Custom Map (Paste JSON)」** に切り替えると、任意の `MapData` JSON を貼り付けてそのマップで遊べる。

### UI フロー

1. `+ NEW GAME` → Map 選択で「Custom Map (Paste JSON)」を選択
2. 表示される textarea に JSON を貼り付け
3. リアルタイムバリデーション（`✓ Valid` / `✗ エラー内容`）
4. CREATE を押すと部屋が作成される

### 必須フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `width` | number | マップの幅（px） |
| `height` | number | マップの高さ（px） |
| `walls` | Wall[] | 地形オブジェクト配列（空配列可） |
| `spawnPoints` | SpawnPoint[] | 2エントリ以上必須（red・blue各1以上） |

`id`・`flagPositions` など他フィールドは省略可（省略時はサーバーのデフォルト値を使用）。

### JSON 例（riverside マップをベースにした最小構成）

```json
{
  "id": "my-map",
  "width": 1600,
  "height": 1200,
  "walls": [
    { "x": 760, "y": 0, "width": 80, "height": 350, "type": "river" }
  ],
  "spawnPoints": [
    { "team": "red", "x": 150, "y": 600, "radius": 120 },
    { "team": "blue", "x": 1450, "y": 600, "radius": 120 }
  ],
  "flagPositions": [
    { "team": "red", "x": 550, "y": 600 },
    { "team": "blue", "x": 1050, "y": 600 }
  ]
}
```

### 実装詳細

| 処理 | 場所 |
|---|---|
| クライアントバリデーション | `client/src/main.ts` – `validateCustomMapJson()` |
| UI（textarea・ステータス表示） | `client/src/ui/dom.ts` `#custom-map-area` |
| 送信フィールド | `shared/src/index.ts` `createRoom.payload.customMapData` |
| サーバー受信 | `server/src/network/handlers.ts` `createRoom` ケース |
| マップ解決 | `server/src/room.ts` – `customMapData ?? MAPS[mapId] ?? DEFAULT_MAP` |

---

## プリファブオブジェクト（MapObject）

マップには Wall の他に `objects: MapObject[]` でプリファブオブジェクトを配置できる。
`expandMapObjects()` がゲーム起動時に MapObject を Wall[] にフラット展開し、物理衝突に使用する。

### PrefabType 一覧

| カテゴリ | タイプ | 概要 |
|---|---|---|
| **HOUSES** | `house-s` / `house-m` / `house-l` | 小/中/大の建物。wall タイプの壁で構成 |
| **BASES** | `base-1open` | 1方向が開いた要塞 |
| | `base-2open-opposite` | 向かい合う2方向が開いた要塞 |
| | `base-2open-adjacent` | 隣接する2方向が開いた要塞 |
| | `base-3open` | 3方向が開いた要塞 |
| **RIVERS** | `river-s` / `river-m` / `river-l` | 直線の川（短/中/長）|
| | `river-elbow-gentle-s` / `-l` | 緩やかなカーブ（半径 300 / 500） |
| | `river-elbow-mid-s` / `-l` | 中程度のカーブ（半径 200 / 350） |
| | `river-elbow-sharp-s` / `-l` | 急カーブ（半径 120 / 180） |
| **BRIDGES** | `bridge-s` / `bridge-l` | 短/長の橋（passable） |
| **OTHER** | `oneway` | 単体ワンウェイ壁 |
| | `bush` | 単体ブッシュ |

### エルボー描画

エルボー系（`river-elbow-*`）はエディタ上では Canvas `ctx.arc()` によるドーナツセクター形状で描画される（矩形の重ね合わせではなくスムーズな曲線）。ゲーム内衝突判定は `expandMapObjects()` が生成した Wall[] を使用。

```typescript
// MapObject の型（shared/src/index.ts）
type MapObject = {
  type: PrefabType;
  x: number;       // 配置原点 X（ワールド座標）
  y: number;       // 配置原点 Y
  rotation?: number; // 回転（度）
};
```

### 実装詳細

| 処理 | 場所 |
|---|---|
| プリファブ定義 | `shared/src/prefabs.ts` – `PREFAB_REGISTRY` |
| Wall展開 | `shared/src/prefabs.ts` – `expandMapObjects(mapData)` |
| エディタ描画 | `client/src/ui/mapEditor.ts` – `drawRiverElbow()` / `expandObject()` |

---

## マップエディタ

ロビーの **MAP EDITOR** ボタン（`#map-editor-btn`）から開くビジュアルエディタ。

### 機能概要

| 機能 | 操作 |
|---|---|
| マップサイズ | Small (800×600) / Medium (1200×900) / Large (1800×1200) / Custom 選択 |
| 壁描画 | パレットから地形タイプを選択してキャンバス上でドラッグ |
| スポーン/フラッグ/アイテム配置 | パレットから選択してクリック配置 |
| プリファブ配置 | PREFABSセクションから選択してクリック配置 |
| 対称配置 | NONE / H（左右）/ V（上下）/ PT（点対称） |
| 選択・移動 | オブジェクトをクリック選択後にドラッグ |
| リサイズ | 壁選択時に8方向ハンドルが表示される |
| 回転 | R / Q キーで ±15° 回転（プリファブのみ有効） |
| 削除 | Del キー または DELETE ボタン |
| アンドゥ/リドゥ | Ctrl+Z / Ctrl+Y（最大50ステップ） |
| グリッドスナップ | Grid Snap チェックボックス（グリッドサイズ 20px） |
| ズーム・パン | スクロールでズーム、Space+ドラッグでパン |
| JSON インポート | LOAD JSON ボタンで既存 MapData を読み込み |
| JSON エクスポート | EXPORT JSON ボタンでクリップボードに書き出し |
| プレイテスト | PLAY TEST ボタンでカスタムマップとして即座にルーム作成 |

### 実装

| 処理 | 場所 |
|---|---|
| エディタ全体 | `client/src/ui/mapEditor.ts` – `openMapEditor()` |
| ボタン登録 | `client/src/main.ts` – `#map-editor-btn` click handler |
| コンテナ DOM | `client/src/ui/dom.ts` – `#map-editor-container` |

---

## MapData 型

```typescript
type MapData = {
  id: string;
  width: number;
  height: number;
  walls: Wall[];
  spawnPoints: { team: Team; x: number; y: number; radius?: number }[];
  flagPositions?: { team: Team; x: number; y: number }[]; // 省略時はspawnPointsを使用。同チーム複数可
};

type Flag = {
  team: Team;
  x: number;
  y: number;
  baseX: number; // 元の配置位置（リセット先）
  baseY: number;
  carrierId: string | null;
  droppedById?: string;
};
```
