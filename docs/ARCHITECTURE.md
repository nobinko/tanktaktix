# アーキテクチャ概要

TankTaktix の技術構成・ディレクトリ構造・モジュール分割・データ型・通信仕様を定義する。

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| **サーバ** | Node.js + TypeScript, Express, ws (WebSocket) |
| **クライアント** | TypeScript, Vite, Canvas 2D API, Web Audio API |
| **共通型** | TypeScript (`@tanktaktix/shared`) |
| **デプロイ** | Render.com (Web Service, 無料枠) |

---

## ディレクトリ構造

```
tanktaktix/
├── server/src/
│   ├── index.ts              # エントリポイント（Express + WebSocket サーバ起動）
│   ├── constants.ts          # ゲーム定数（速度・半径・クールダウン等）
│   ├── state.ts              # グローバル状態（players, rooms の Map）
│   ├── types.ts              # サーバ内部型（PlayerRuntime, Room, Bullet）
│   ├── room.ts               # ルーム作成・参加・退出・アイテム管理
│   ├── tick.ts               # ゲームループ（20Hz tick 処理）
│   ├── network/
│   │   ├── handlers.ts       # WebSocket メッセージハンドラ（login〜chat）
│   │   ├── broadcast.ts      # 状態ブロードキャスト（ロビー・ルーム）
│   │   └── httpApp.ts        # Express HTTP アプリ（静的配信・ヘルスチェック）
│   ├── systems/
│   │   ├── combat.ts         # ダメージ・爆発・HP 計算・射撃・アイテム使用
│   │   ├── projectiles.ts    # 弾丸・パス弾の飛翔・壁衝突・プレイヤー命中判定
│   │   ├── movement.ts       # 移動目標設定・ピボットターン・AIM 方向
│   │   └── ctf.ts            # CTF フラッグ追従・キャプチャ・帰還判定
│   └── utils/
│       ├── collision.ts      # 衝突判定（AABB、Liang-Barsky、ブッシュ判定）
│       ├── id.ts             # ユニーク ID 生成
│       └── math.ts           # 数学ユーティリティ（clamp, norm, len 等）
│
├── client/src/
│   ├── main.ts               # エントリポイント（画面遷移管理）
│   ├── state.ts              # クライアント側状態保持
│   ├── style.css             # スタイルシート
│   ├── audio/
│   │   └── SoundManager.ts   # Web Audio API ベースの SE 管理
│   ├── input/
│   │   ├── keyboard.ts       # キーボード入力ハンドラ
│   │   └── mouse.ts          # マウス入力（AIM ドラッグ含む）
│   ├── net/
│   │   ├── wsClient.ts       # WebSocket 接続管理
│   │   └── handlers.ts       # サーバメッセージハンドラ
│   ├── render/
│   │   ├── renderer.ts       # メインレンダラー（rAF ループ）
│   │   ├── world.ts          # 地形描画（壁・ブッシュ・水場・家・ワンウェイ）
│   │   ├── entities.ts       # エンティティ描画（タンク・弾丸・アイテム・フラッグ）
│   │   ├── hud.ts            # HUD 描画（HP・弾薬・スコア・ミニマップ・チャット）
│   │   ├── effects.ts        # 爆発 VFX（ローカル管理）
│   │   ├── titleRenderer.ts  # タイトル画面背景（diep.io 方式）
│   │   └── assets.ts         # アセット読み込み
│   └── ui/
│       ├── dom.ts            # DOM UI（ロビー・ログイン・ルームカード）
│       └── modal.ts          # モーダルダイアログ
│
├── shared/src/
│   ├── index.ts              # 共通型定義（メッセージ・エンティティ型）
│   └── maps.ts               # マップ定義（5マップ + 3テストマップ）
│
├── scripts/                  # 検証・テストスクリプト
│   ├── verify_*.ts           # 機能別検証スクリプト
│   └── simulate_4v4.ts       # 負荷テスト（8クライアント同時接続）
│
└── docs/                     # プロジェクトドキュメント
```

---

## 3層アーキテクチャ

```
┌─────────────────────────────────────┐
│          Client (Browser)           │
│  Canvas 描画 / 入力処理 / 音声再生   │
└───────────────┬─────────────────────┘
                │ WebSocket (JSON)
                │ ws://host/ws
┌───────────────▼─────────────────────┐
│          Server (Node.js)           │
│  ゲームロジック / 物理計算 / 権威     │
└───────────────┬─────────────────────┘
                │ npm workspace
┌───────────────▼─────────────────────┐
│          Shared (Types)             │
│  メッセージ型 / エンティティ型       │
└─────────────────────────────────────┘
```

### 各レイヤーの責務

**Shared** -- 型定義のみ（ロジックなし）

- `ClientToServerMessage`, `ServerToClientMessage` の Union 型
- `PlayerSummary`, `RoomState`, `LobbyState`, `MapData`, `Item`, `Flag` 等のデータ型
- `WallType`, `ItemType`, `Team`, `RoomOptions` 等の列挙的型
- マップ定義（`maps.ts` に全マップデータを格納）
- client/server 両方が import する。ロジックは一切持たない

**Server** -- サーバ権威・ゲームロジック

- `index.ts`: Express + WebSocket サーバの起動と `setInterval(tick, 50ms)` の登録
- `state.ts`: グローバルな `players: Map<string, PlayerRuntime>` と `rooms: Map<string, Room>` を保持
- `tick.ts`: 20Hz ゲームループ本体。各ルームに対しリスポーン・隠密判定・移動・CTF・弾丸処理を実行
- `room.ts`: ルーム作成（`createRoom`）・参加（`joinRoom`）・退出（`detachFromRoom`）・チーム割当・スポーン・アイテム初期化
- `network/handlers.ts`: WebSocket メッセージの受信と各システムへの振り分け
- `network/broadcast.ts`: ルーム状態・ロビー状態のシリアライズとブロードキャスト（プレイヤー向け隠密フィルタリング付き）
- `systems/combat.ts`: 射撃処理・爆発トリガー・ダメージ計算・キル処理・アイテム使用（rope / ammoPass / healPass / flagPass）
- `systems/projectiles.ts`: 弾丸の飛翔・壁衝突・プレイヤー命中・パス弾のキャッチ判定
- `systems/movement.ts`: 移動目標キューイング・ピボットターン・AIM 方向設定
- `systems/ctf.ts`: CTF フラッグ追従・キャプチャ判定・ドロップ時の即座帰還
- `utils/`: 衝突判定（AABB, Liang-Barsky, ブッシュ判定）、ID 生成、数学ユーティリティ
- 隠密状態管理: ブッシュに完全侵入で `isHidden = true`（射撃しても解除されない）
- 観戦モード: `spectatorIds` で管理。隠密フィルタなしで全プレイヤーを表示
- Express で静的ファイル（`client/dist`）を配信

**Client** -- 描画・入力・UI

- サーバからの状態を受け取って Canvas に描画（60fps rAF）
- マウス/キーボード入力を WebSocket メッセージに変換してサーバへ送信
- ローカル予測なし（サーバ権威の状態をそのまま描画）
- `SoundManager.ts` による Web Audio API ベースの効果音再生
- DOM UI でロビー画面・ルーム作成モーダル・チャットを管理
- Ping 計測: クライアントがサーバに `ping` を送信し、`pong` の往復時間を計測して `reportPing` で通知

---

## マルチロビー

TankTaktix は複数のロビーに対応している。`constants.ts` に定義された `AVAILABLE_LOBBIES` 配列で利用可能なロビーが管理される。

```
利用可能なロビー:
  1. "Main Lobby"    -- デフォルトのメインロビー
  2. "Sub Lobby 1"   -- サブロビー 1
  3. "Sub Lobby 2"   -- サブロビー 2
```

### ロビー管理の仕組み

- 各 `PlayerRuntime` は `lobbyId` フィールドを持ち、現在所属するロビーを示す
- 各 `Room` も `lobbyId` フィールドを持ち、作成されたロビーに紐付く
- 接続時のデフォルトロビーは `AVAILABLE_LOBBIES[0]`（"Main Lobby"）
- クライアントは `switchLobby` メッセージでロビーを切り替えられる
- ロビー切り替え時、現在のルームから退出される（`joinLobby` 内で `detachFromRoom` を呼び出し）

### ロビー状態の配信

`LobbyState` は以下の情報を含み、同一ロビー内の全プレイヤーにブロードキャストされる。

```typescript
type LobbyState = {
  rooms: RoomSummary[];         // 同一ロビー内の未終了ルーム一覧
  onlinePlayers: { id: string; name: string }[];  // 同一ロビー内のオンラインプレイヤー
  currentLobbyId: string;       // 現在のロビー ID
  availableLobbies: string[];   // 全利用可能ロビー名リスト
};
```

ルーム作成・参加・退出・プレイヤーのログイン/切断が発生するたびに、該当ロビーの全プレイヤーへ `lobby` メッセージがブロードキャストされる。異なるロビーのプレイヤーには影響しない。

---

## ゲームループ

サーバの `tick.ts` が 20Hz（50ms 間隔）でゲーム状態を更新する。各サブシステムはモジュールに分割されている。

```
Server (20Hz = 50ms ごと):
  tick() {
    各ルームについて:
      1. 爆発配列のクリア（前 tick 分を破棄）
      2. ゲーム終了判定（endsAt 超過 → gameEnd ブロードキャスト → 物理更新を停止）
      3. 空ルームのクリーンアップ（終了済み + プレイヤー/観戦者 0 人 → 削除）
      4. 各プレイヤーについて:
         a. リスポーン処理（respawnAt に達したら spawnPlayer）
         b. 隠密状態更新（isPointInBush で isHidden を判定）
         c. 移動フェーズ:
            - クールダウン中 → 移動凍結
            - pendingMove あり → 方向移動
            - moveQueue あり → ピボットターン → 前進（boots 速度 1.5 倍補正）
            - 目的地到着 → クールダウン開始（移動距離で長短を判定）
         d. 壁・プレイヤー間衝突判定
         e. アイテム拾得判定（所持上限チェック → 効果適用 → リスポーン）
         f. フラッグ拾得判定（CTF モード時、敵旗取得 / 自旗回収）
      5. CTF 判定 ← systems/ctf.ts
         - フラッグ追従・キャプチャ（自陣 + 停止で得点）・ドロップ即帰還
      6. 弾丸処理 ← systems/projectiles.ts
         - 飛翔・壁衝突・プレイヤー命中・爆発トリガー
         - 特殊弾: bomb / rope / ammoPass / healPass / flagPass
      7. sendRoomState() で全員に状態をブロードキャスト
         - プレイヤー向け: 敵の隠密プレイヤーをフィルタリング
         - 観戦者向け: 全プレイヤー表示（隠密フィルタなし）
  }

Client (60fps rAF):
  draw() {
    カメラ変換（zoom / rotation / pan）
    地形描画（壁・bush・water・house・oneway・グリッド）
    弾丸描画（通常弾 / bomb / rope / ammoPass / healPass / flagPass）
    爆発エフェクト（VFX、ローカル管理）
    アイテム（medic / ammo / heart / bomb / rope / boots）を描画
    フラッグ（CTF の旗）を描画
    各プレイヤー（ハル + 砲塔 + ダメージ可視化（多角形欠損・炎上） + アイテム表示 + 旗インジケーター）を描画
    移動予約マーカーを描画
    AIM ガイドライン（射撃ドラッグ中）を描画
    HUD 描画（スクリーン空間）
      タイマー / HP / 弾薬 / チームスコア / HIDDEN インジケーター
      ミニマップ（プレイヤー・壁・アイテム・フラッグ・ビューポート表示）
      チャットログ
  }
```

---

## 主要な内部データ構造

### PlayerRuntime（サーバ内部）

サーバ側でプレイヤーの全状態を管理する型。`server/src/types.ts` に定義。

```typescript
type PlayerRuntime = {
  // 識別
  id: string;
  name: string;
  team: Team;                  // "red" | "blue" | null
  roomId: string | null;
  lobbyId: string;             // 所属ロビー ID

  // 位置・姿勢
  x: number;
  y: number;
  hullAngle: number;           // 車体向き（ラジアン）
  turretAngle: number;         // 砲塔向き（ラジアン）

  // 移動状態
  pendingMove: Vector2 | null;
  moveQueue: {                 // 最大 5 件（MOVE_QUEUE_MAX）
    x: number;
    y: number;
    startX: number;            // 移動開始地点（距離算出用）
    startY: number;
  }[];
  isMoving: boolean;
  isRotating: boolean;         // ピボットターン中フラグ

  // AIM
  aimDir: Vector2;             // AIM モード中の砲塔方向

  // アクション制御
  cooldownUntil: number;       // クールダウン終了 Unix ms
  respawnAt: number | null;    // リスポーン予定時刻
  respawnCooldownUntil: number;// リスポーン無敵期間終了 Unix ms

  // ステータス
  hp: number;                  // 0〜100（instantKill モード時は 0〜20）
  ammo: number;                // 0〜40（初期 20、ammo アイテムで補充）
  score: number;
  kills: number;
  deaths: number;
  hits: number;
  fired: number;
  lives: number;               // instantKill モード用ライフ

  // 隠密・可視性
  isHidden: boolean;           // bush 完全侵入で隠密（射撃しても解除されない）

  // アイテム所持状態
  hasBomb: boolean;            // bomb 所持中（次の射撃がボムショットになる）
  ropeCount: number;           // rope 所持本数（0〜2）
  bootsCharges: number;        // boots 残り回数（0 = 未所持, 1〜3 = 残り）

  // 接続
  socket: WebSocket | null;    // 接続中のソケット（切断時は null）
  disconnectedAt: number | null; // 切断時刻
  ping: number;                // クライアントから報告された Ping 値（ms）
};
```

### Room（サーバ内部）

ルームの全状態を管理する型。`server/src/types.ts` に定義。

```typescript
type Room = {
  id: string;
  name: string;
  mapId: string;               // マップ ID（"alpha" | "beta" | ... ）
  mapData: MapData;            // マップ定義（壁・スポーン地点）
  lobbyId: string;             // 所属ロビー ID
  passwordProtected: boolean;
  password?: string;
  maxPlayers: number;
  timeLimitSec: number;
  createdAt: number;           // ルーム作成時刻 Unix ms
  endsAt: number;              // ゲーム終了時刻 Unix ms
  ended: boolean;
  gameMode: "deathmatch" | "ctf";
  options: {
    teamSelect: boolean;       // チーム手動選択モード
    instantKill: boolean;      // 即死モード（HP 20）
    noItemRespawn: boolean;    // アイテムリスポーン無効
    noShooting: boolean;       // 射撃禁止モード
  };
  hostId: string;              // ルーム作成者の ID

  playerIds: Set<string>;
  spectatorIds: Set<string>;   // 観戦者 ID セット
  bullets: Bullet[];
  explosions: Explosion[];     // 1 tick だけ保持しブロードキャスト後クリア
  items: Item[];               // マップ上のアイテム（固定プール制、各種 2 個ずつ = 12 個）
  lastItemSpawnAt: number;     // 最後のアイテムスポーン時刻
  flags: Flag[];               // CTF の旗（CTF モード時のみ使用）
  scoreRed: number;
  scoreBlue: number;

  history: Map<string, {       // 退出後もスコアを保持する履歴
    name: string;
    team: Team;
    kills: number;
    deaths: number;
    score: number;
    fired: number;
    hits: number;
  }>;
};
```

### Bullet（サーバ内部）

弾丸の状態。通常弾・ボム弾・ロープ弾・各種パス弾を統一的に管理する。

```typescript
type Bullet = {
  id: string;
  shooterId: string;
  x: number; y: number;       // 現在位置
  vx: number; vy: number;     // 速度ベクトル
  radius: number;             // 当たり判定半径
  startX: number; startY: number; // 発射位置（距離計算用）
  expiresAt: number;          // 有効期限 Unix ms

  // 特殊弾フラグ（省略時は通常弾）
  isBomb?: boolean;           // ボム弾（3 倍爆発半径・3 段階ダメージ）
  isRope?: boolean;           // ロープ弾（敵を引き寄せる）
  ropeOwnerId?: string;       // ロープの所有者 ID
  isAmmoPass?: boolean;       // 弾薬パス弾（味方に弾薬を補給）
  isHealPass?: boolean;       // 回復パス弾（味方を回復）
  isFlagPass?: boolean;       // フラッグパス弾（旗を味方に投げる）
  flagTeam?: Team;            // パスされるフラッグのチーム
};
```

### 共通型（Shared）

`shared/src/index.ts` に定義される、クライアント/サーバ共通の型。

```typescript
type Team = "red" | "blue" | null;
type ItemType = "medic" | "ammo" | "heart" | "bomb" | "rope" | "boots";
type WallType = "wall" | "bush" | "water" | "house" | "oneway";

type Item = {
  id: string; x: number; y: number;
  type: ItemType; spawnedAt: number;
};

type Wall = {
  x: number; y: number; width: number; height: number;
  type?: WallType;     // 省略時は "wall"
  direction?: "up" | "down" | "left" | "right"; // oneway 用
};

type MapData = {
  id: string; width: number; height: number;
  walls: Wall[];
  spawnPoints: { team: Team; x: number; y: number }[];
  flagPositions?: { team: Team; x: number; y: number }[];
};

type Flag = {
  team: Team;
  x: number; y: number;
  carrierId: string | null;
  droppedById?: string;        // 即座再拾得防止用
};

type RoomOptions = {
  teamSelect: boolean;
  instantKill: boolean;
  noItemRespawn: boolean;
  noShooting: boolean;
};
```

---

## 通信フロー

### クライアントからサーバへ（ClientToServerMessage）

| メッセージ | ペイロード | 説明 |
|---|---|---|
| `login` | `{ name, id? }` | ログイン / 再接続 |
| `requestLobby` | なし | ロビー状態を要求 |
| `switchLobby` | `{ lobbyId }` | ロビー切り替え |
| `createRoom` | `{ roomId, name, mapId, maxPlayers, timeLimitSec, gameMode?, password?, options? }` | ルーム作成 |
| `joinRoom` | `{ roomId, password? }` | ルーム参加 |
| `spectateRoom` | `{ roomId, password? }` | 観戦モードで参加 |
| `selectTeam` | `{ team }` | チーム手動選択（teamSelect モード時） |
| `leaveRoom` | なし | ルーム退出 |
| `move` | `{ target }` | 移動目標を指定 |
| `stopMove` | なし | 移動キューを全消去して停止 |
| `moveCancelOne` | なし | 移動キューの末尾を 1 件取り消し |
| `aim` | `{ direction }` | 砲塔の AIM 方向を更新 |
| `shoot` | `{ direction }` | 射撃（AIM 方向指定） |
| `useItem` | `{ item, direction }` | アイテム使用（rope / ammo / heal / flag） |
| `chat` | `{ message, channel? }` | チャット送信（global / team） |
| `ping` | `{ timestamp }` | Ping 計測用タイムスタンプ送信 |
| `reportPing` | `{ ping }` | 計測済み Ping 値の報告 |

### サーバからクライアントへ（ServerToClientMessage）

| メッセージ | ペイロード | 説明 |
|---|---|---|
| `welcome` | `{ id }` | 接続確認・プレイヤー ID 通知 |
| `lobby` | `LobbyState` | ロビー状態（ルーム一覧・オンラインプレイヤー） |
| `roomInit` | `RoomInitState` | ルーム参加時の初回大容量データ（マップ構造全体など） |
| `room` | `RoomState` | ルーム状態（20Hz で配信、マップデータ等は差分化） |
| `explosion` | `Explosion` | 爆発イベント（即時配信、VFX トリガー用） |
| `chat` | `ChatMessage` | チャットメッセージ |
| `gameEnd` | `{ roomId, winners, results }` | ゲーム終了通知 |
| `error` | `{ message }` | エラー通知 |
| `pong` | `{ timestamp }` | Ping 応答 |

### 通信シーケンス例（ルーム参加からゲーム終了まで）

```
Client                              Server
  │                                   │
  │── login { name, id? } ──────────▶│ プレイヤー登録 or 再接続
  │◀─ welcome { id } ─────────────────│
  │◀─ lobby { rooms, onlinePlayers } ─│
  │                                   │
  │── createRoom { ..., gameMode } ──▶│ ルーム作成 → lobby ブロードキャスト
  │── joinRoom { roomId } ───────────▶│ チーム割当・スポーン
  │◀─ roomInit { mapData, ... } ──────│ 参加成功・初回大容量データ送信
  │◀─ room { players, items,          │
  │         flags, ... } ──────────────│
  │                                   │
  │    ← 20Hz で room ブロードキャスト ──│ tick ごとに状態同期（差分ペイロード）
  │                                   │
  │── move { target } ───────────────▶│ moveQueue に追加
  │── shoot { direction } ───────────▶│ 弾丸生成・クールダウン開始
  │◀─ explosion { ... } ──────────────│ 命中時に即時配信
  │                                   │
  │── useItem { item, direction } ───▶│ 特殊弾生成
  │── chat { message, channel } ─────▶│ チャットブロードキャスト
  │                                   │
  │◀─ gameEnd { winners, results } ────│ endsAt 超過時
  │── leaveRoom ─────────────────────▶│ 退出 → lobby ブロードキャスト
```

---

## 主要定数（server/src/constants.ts）

| 定数名 | 値 | 説明 |
|---|---|---|
| `PORT` | 3000 | サーバポート（環境変数で上書き可） |
| `TICK_MS` | 50 | tick 間隔（20Hz） |
| `MOVE_SPEED` | 6 | 基本移動速度（px/tick） |
| `BULLET_SPEED` | 220 | 弾丸速度（px/sec） |
| `BULLET_RADIUS` | 4 | 通常弾の半径 |
| `TANK_SIZE` | 18 | タンクの半径 |
| `EXPLOSION_RADIUS` | 40 | 通常爆発半径（bomb は 3 倍） |
| `EXPLOSION_DAMAGE` | 20 | 通常爆発ダメージ |
| `ACTION_COOLDOWN_MS` | 1800 | 射撃後のクールダウン |
| `COOLDOWN_SHORT_MS` | 1500 | 短距離移動後のクールダウン |
| `COOLDOWN_LONG_MS` | 2100 | 長距離移動後のクールダウン |
| `RESPAWN_MS` | 1500 | リスポーン待機時間 |
| `RESPAWN_COOLDOWN_MS` | 1500 | リスポーン後無敵時間 |
| `MOVE_QUEUE_MAX` | 5 | 移動キュー最大件数 |
| `MAX_MOVE_DIST` | 300 | 1 回の移動指定の最大距離 |
| `RECONNECT_TIMEOUT_MS` | 60000 | 再接続タイムアウト（60 秒） |
| `FLAG_RADIUS` | 25 | フラッグの拾得判定半径 |
| `FLAG_SCORE` | 5 | フラッグキャプチャ時のチームスコア加算 |
| `ITEM_RADIUS` | 15 | アイテムの拾得判定半径 |
| `MEDIC_HEAL_AMOUNT` | 20 | medic の回復量 |
| `AMMO_REFILL_AMOUNT` | 10 | ammo の補充量 |

### アイテムプール（固定 12 個）

| アイテム | 個数 | 効果 |
|---|---|---|
| medic | 2 | HP +20 回復 |
| ammo | 2 | 弾薬 +10 補充 |
| heart | 2 | HP 全回復 |
| bomb | 2 | 次の射撃がボムショット（3 倍爆発半径） |
| rope | 2 | ロープ弾（敵を引き寄せる、最大 2 本所持） |
| boots | 2 | 移動速度 1.5 倍（3 回分） |

---

## ゲームモード

### Deathmatch

チーム対抗のキル数競争。キル +1 点がチームスコアに加算される。自爆時は相手チームに +1 点。制限時間終了時にスコアの高いチームが勝利。

### Capture The Flag (CTF)

敵チームの旗を奪い、自陣のスポーンゾーン内で停止するとキャプチャ成立（+5 点）。キルによるスコア加算は Deathmatch と同じ。フラッグはダメージを受けると即座にドロップし、ドロップされた旗は即座に元の基地に帰還する。`flagPass` アイテムアクションで味方にフラッグを投げ渡すことも可能。

### ルームオプション

| オプション | 説明 |
|---|---|
| `teamSelect` | チーム手動選択モード。参加時は未割当で、`selectTeam` で選択してからスポーン |
| `instantKill` | 即死モード。HP が 20 に設定される |
| `noItemRespawn` | アイテムが拾われてもリスポーンしない |
| `noShooting` | 射撃禁止モード |

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

**無料枠の制約:**

- 15 分間トラフィックがないとスリープ（復帰に最大 1 分）
- ローカルファイルシステムの変更は再起動で消える（インメモリ状態も揮発）
- 詳細は `docs/archive/deep-research-report.md` の「Render 無料枠対策」を参照

---

## スケーリング方針

### 現実目標

**最大 16 vs 16（= 32 人 / room）をターゲットにゲームとしての完成を優先する。**

50 vs 50（= 100 人）は設計メモとして保持するのみ。現在は実装しない。

### 設計上の禁止・制約

| 決定 | 理由 |
|---|---|
| **距離ベース AOI は採用しない** | ロングショットが成立するゲーム性のため、近傍以外を送らない最適化は禁止 |
| **ステルス送信フィルタは例外として維持** | ブッシュ内の不可視対象の座標を敵クライアントへ送信しないフィルタはゲーム仕様（B-5） |
| **LOD は頻度/精度の段階化のみ** | 送信対象の除外（cull）はしない |
| **Projectile / Hit / Explosion の優先度を落とさない** | ゲーム性の核。最適化しても送信優先度は維持 |

### 32人同室の完成条件

- [ ] サーバ tick が 50ms 以内に完了し続ける（連続的な超過は NG）
- [ ] クライアント描画が大きく破綻しない（FPS の著しい低下なし）
- [ ] 勝敗・リザルト・退室・再接続が壊れない
- [ ] 入力遅延・ワープが致命的でない

### 将来（50vs50）設計メモ

> **今は実装しない。** 方向性だけ固定し、将来の設計判断に使う。

優先アプローチ (一部実装済み):
- **Delta 配信 (完了)**: `roomInit` と `room` に分け、差分のみ送信しフルスナップショットを減らす。ブロードキャスト文字列のキャッシュ化導入済み。
- **空間インデックス (部分完了)**: 完全なSpatial Hash Gridは未導入だが、マンハッタン距離を用いた Early Reject により弾丸×プレイヤーの衝突判定の `O(N^2)` を大幅に削減。
- **スポーンの面配置 (完了)**: スポーン位置をただの「点」ではなく `radius`（半径）を持つ「面（エリア）」とし、無敵時間中のすり抜けにより、多数のプレイヤーが同時に湧いてもスタックしない仕組みを実装。

採用しないこと:
- Rollback（巻き戻し同期）: 複雑度が高く、現行の権威モデルで十分
- 本格的な Client-side Prediction: 同上
- 距離 AOI で「見えない弾」を作る最適化: ゲーム性を壊す
