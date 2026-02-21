# アーキテクチャ概要

TankTaktix の技術構成・ディレクトリ構造・コンポーネント間の責務を定義する。

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| **サーバ** | Node.js + TypeScript, Express, ws (WebSocket) |
| **クライアント** | TypeScript, Vite, Canvas 2D API |
| **共通型** | TypeScript (`@tanktaktix/shared`) |
| **デプロイ** | Render.com (Web Service, 無料枠) |

---

## ディレクトリ構造

```
tanktaktix/
├── client/                  # フロントエンド（Vite + TypeScript）
│   ├── src/
│   │   ├── main.ts          # エントリポイント（画面管理・描画・入力すべてここ）
│   │   └── style.css        # スタイル
│   └── index.html
│
├── server/                  # バックエンド（Node.js + Express + WebSocket）
│   └── src/
│       └── index.ts         # エントリポイント（ゲームロジック・通信すべてここ）
│
├── shared/                  # クライアント/サーバ共通の型定義
│   └── src/
│       └── index.ts         # 型定義のみ（ロジックなし）
│
├── scripts/                 # 検証・テストスクリプト（ts-node で実行）
│   ├── verify_*.ts          # 機能別検証スクリプト
│   └── simulate_4v4.ts      # 負荷テスト（8クライアント同時接続）
│
└── docs/                    # プロジェクトドキュメント
```

---

## 3層アーキテクチャ

```
┌─────────────────────────────────┐
│         Client (Browser)        │
│  Canvas描画 / 入力処理 / 状態管理  │
└──────────────┬──────────────────┘
               │ WebSocket (JSON)
               │ ws://host/ws
┌──────────────▼──────────────────┐
│         Server (Node.js)        │
│  ゲームロジック / 物理計算 / 権威  │
└──────────────┬──────────────────┘
               │ npm workspace
┌──────────────▼──────────────────┐
│         Shared (Types)          │
│  メッセージ型 / エンティティ型     │
└─────────────────────────────────┘
```

### 各レイヤーの責務

**Shared** — 型定義のみ
- `ClientToServerMessage`, `ServerToClientMessage` の Union 型
- `PlayerSummary`, `RoomState`, `MapData`, `Item`, `Flag` 等のデータ型
- `WallType`, `ItemType` 等の列挙的型
- ロジックを持たない。client/server 両方が import する

**Server** — サーバ権威・ゲームロジック
- WebSocket 接続管理（`ws` ライブラリ）
- ゲームループ: `setInterval(tick, 50ms)` = 20Hz
- 物理計算（移動・弾道・衝突）はすべてサーバが計算
- アイテムスポーン・拾得判定、CTF フラッグ判定
- 隠密（bush）状態管理、再接続セッション保持
- クライアントからの入力を検証し、不正なら拒否する
- Express で静的ファイル（client/dist）を配信

**Client** — 描画・入力・UI
- サーバからの状態を受け取って Canvas に描画（60fps rAF）
- マウス/キーボード入力を WebSocket メッセージに変換してサーバへ送信
- ローカル予測なし（サーバ権威の状態をそのまま描画）
- 再接続: `localStorage` に ID を保存し、login 時に送信

---

## ゲームループ

```
Server (20Hz = 50ms ごと):
  tick() {
    各ルームについて:
      1. 死亡プレイヤーのリスポーン処理
      2. 移動フェーズ（ピボットターン → 前進）
      3. 弾丸の飛翔・衝突・爆発処理
      4. アイテムスポーン・拾得判定（B-1）
      5. 隠密状態更新（bush 内判定 / 射撃後の可視化）（B-5）
      6. CTF フラッグ判定（取得・帰還・完全停止スコア）（B-4）
      7. ゲーム終了判定（endsAt 超過）
      8. sendRoomState() で全員に状態をブロードキャスト
  }

Client (60fps rAF):
  draw() {
    カメラ変換（zoom / rotation / pan）
    ← 地形（壁・bush・water・グリッド）を描画
    ← 弾丸を描画
    ← 爆発エフェクト（VFX、ローカル管理）
    ← アイテム（medic / ammo ボックス）を描画
    ← フラッグ（CTF の旗）を描画
    ← 各プレイヤー（ハル + 砲塔 + HP/弾薬バー + ロックカウント + 旗インジケーター）を描画
    ← 移動予約マーカーを描画
    ← AIMガイドライン（射撃ドラッグ中）を描画
    HUD描画（スクリーン空間）
    ← タイマー / HP / 弾薬 / チームスコア / HIDDEN インジケーター
    ← ミニマップ（プレイヤー・壁・アイテム・フラッグ・ビューポート表示）
    ← チャットログ
  }
```

---

## 主要な内部データ構造

### PlayerRuntime（サーバ内部）

```typescript
type PlayerRuntime = {
  // 識別
  id: string;
  name: string;
  team: "red" | "blue" | null;
  roomId: string | null;

  // 位置・姿勢
  x: number;
  y: number;
  hullAngle: number;    // 車体向き（ラジアン）
  turretAngle: number;  // 砲塔向き（ラジアン）

  // 移動状態
  moveQueue: { x: number; y: number; cost: number }[]; // 最大5件
  isMoving: boolean;
  isRotating: boolean;  // ピボットターン中フラグ
  pendingMove: Vector2 | null;

  // アクション制御
  cooldownUntil: number;        // クールダウン終了 Unix ms
  respawnCooldownUntil: number; // 無敵期間終了 Unix ms

  // ステータス
  hp: number;    // 0〜100
  ammo: number;  // 0〜20（アイテムで最大40）
  score: number;
  kills: number;
  deaths: number;
  hits: number;
  fired: number;

  // 隠密・可視性（B-5）
  isHidden: boolean;     // bush 内で隠密中
  lastFiredAt: number;   // 射撃後の一時可視化用

  socket: WebSocket; // 接続ソケット（クライアントには非公開）
};
```

### Room（サーバ内部）

```typescript
type Room = {
  id: string;
  name: string;
  gameMode: "deathmatch" | "ctf";   // ゲームモード
  mapData: MapData;                  // マップ定義（壁・スポーン地点）
  maxPlayers: number;
  timeLimitSec: number;
  endsAt: number;           // ゲーム終了時刻 Unix ms
  ended: boolean;

  playerIds: Set<string>;
  bullets: Bullet[];
  explosions: Explosion[];  // 1tick だけ保持してブロードキャスト後クリア
  items: Item[];            // マップ上のアイテム（B-1）
  flags: Flag[];            // CTF の旗（B-4）
  scoreRed: number;
  scoreBlue: number;
  history: Map<string, PlayerHistory>;       // 退出後もスコアを保持
  disconnectedPlayers: Map<string, { ... }>; // 再接続用セッション保持（B-3）
};
```

### 新規型（Phase 3 追加）

```typescript
type ItemType = "medic" | "ammo";
type WallType = "wall" | "bush" | "water";

type Item = {
  id: string; x: number; y: number;
  type: ItemType; spawnedAt: number;
};

type Wall = {
  x: number; y: number; width: number; height: number;
  type?: WallType;  // 省略時は "wall"
};

type Flag = {
  team: Team;          // "red" | "blue"
  x: number; y: number;
  carrierId: string | null;  // 持っているプレイヤーの ID
};
```

---

## 通信フロー例（ルーム参加〜ゲーム終了）

```
Client                          Server
  │                               │
  │── login { name, id? } ──────▶│ プレイヤー登録 or 再接続（B-3）
  │◀─ welcome { id } ─────────────│
  │◀─ lobby { rooms } ────────────│
  │                               │
  │── createRoom { ..., gameMode }▶│ ルーム作成、lobby ブロードキャスト
  │── joinRoom { roomId } ───────▶│ チーム割当・スポーン
  │◀─ room { players, items,      │ 参加成功
  │         flags, mapData, ... } ─│
  │                               │
  │  ← 20Hz で room ブロードキャスト ─│ tick ごとに状態同期
  │                               │
  │── move { target } ──────────▶│ moveQueue に追加
  │── shoot { direction } ───────▶│ 弾丸生成・クールダウン開始
  │◀─ explosion { ... } ──────────│ 命中時に即時配信
  │                               │
  │◀─ gameEnd { winners, results }─│ endsAt 超過時
  │── leaveRoom ─────────────────▶│ 退出、lobby ブロードキャスト
```

---

## デプロイ構成（Render.com 無料枠）

```
Render Web Service
  ├── ビルド: npm ci && npm run build
  │     └── server/dist/index.js + client/dist/ を生成
  └── 起動: npm run start
        └── server/dist/index.js
              ├── GET /        → client/dist/index.html を配信
              ├── GET /health  → { status: "ok" }
              └── WS  /ws      → ゲーム通信
```

**注意事項（無料枠の制約）:**
- 15分間トラフィックがないとスリープ（復帰に最大1分）
- ローカルファイルシステムの変更は再起動で消える（インメモリ状態も揮発）
- 詳細は `docs/archive/deep-research-report.md` の「Render無料枠対策」を参照
