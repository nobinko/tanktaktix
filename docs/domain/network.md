# Network

> 対応コード: `server/src/network/handlers.ts`, `server/src/network/broadcast.ts`, `shared/src/index.ts`, `client/src/net/wsClient.ts`, `client/src/net/handlers.ts`
> **ソース of truth は `shared/src/index.ts`**。型定義と本ドキュメントに乖離が生じた場合はコードを優先すること。

---

## 基本仕様

- エンドポイント: `ws(s)://<host>/ws`
- フォーマット: JSON テキストフレーム
- エンベロープ: `{ "type": string, "payload": any }`

### 互換性ルール

- 互換破壊が必要な変更は `shared/src/index.ts` の型を更新し、本ドキュメントも同時に改訂する
- サーバ権威の判定（衝突・HP・スコア計算）を常に維持する

---

## クライアント → サーバ（C→S）

| type | payload | 説明 |
|---|---|---|
| `login` | `{ name: string, id?: string }` | ログイン。name は最大16文字。id は再接続用 |
| `requestLobby` | なし | ロビー状態を要求する |
| `switchLobby` | `{ lobbyId: string }` | ロビー切り替え |
| `createRoom` | `{ roomId, name, mapId, maxPlayers, timeLimitSec, gameMode?, password?, options? }` | ルーム作成 |
| `joinRoom` | `{ roomId: string, password?: string, requestedTeam?: "red" \| "blue" }` | ルーム参加 |
| `spectateRoom` | `{ roomId: string, password?: string }` | 観戦モードで参加 |
| `selectTeam` | `{ team: "red" \| "blue" }` | チーム手動選択（teamSelect モード時） |
| `leaveRoom` | なし | ルームから退出してロビーへ戻る |
| `move` | `{ target: Vector2 }` | クリック移動。移動中・クールダウン中でも予約として受け付ける |
| `moveCancelOne` | なし | 移動キューの末尾を1つキャンセル（Zキー相当） |
| `stopMove` | なし | 移動キューを全クリアして即座に停止 |
| `aim` | `{ direction: Vector2 }` | AIMモード中の砲塔方向を更新する。direction は単位ベクトル |
| `shoot` | `{ direction: Vector2 }` | 射撃。direction は単位ベクトル |
| `useItem` | `{ item: string, direction: Vector2 }` | AIMアクション派生。item は `"rope"` / `"ammo"` / `"heal"` / `"flag"` |
| `chat` | `{ message: string, channel?: "global" \| "team" }` | チャット送信。最大120文字 |
| `ping` | `{ timestamp: number }` | Ping 計測用タイムスタンプ送信 |
| `reportPing` | `{ ping: number }` | 計測済み Ping 値をサーバに報告 |

### createRoom payload 詳細

```typescript
{
  roomId: string;        // ルームID（空白時はサーバが自動生成）
  name: string;          // 表示名
  mapId: string;         // "alpha" | "beta" | "gamma" | "delta" | "epsilon"
  maxPlayers: number;    // 2〜16（clamp される）
  timeLimitSec: number;  // 5〜3600（clamp される）
  gameMode?: "deathmatch" | "ctf";  // 省略時は "ctf"
  password?: string;     // 省略または空文字で非パスワード保護
  options?: RoomOptions;
}
```

---

## サーバ → クライアント（S→C）

| type | payload | 説明 |
|---|---|---|
| `welcome` | `{ id: string }` | 接続時 + ログイン成功時。id はプレイヤーID |
| `lobby` | `LobbyState` | ロビー状態。ルーム一覧 |
| `roomInit` | `RoomInitState` | 初回の重いペイロード（マップ構造等）。ルーム参加時や観戦開始時に1度だけ送信 |
| `room` | `RoomState` | ゲーム状態。20Hz（50ms）ごとにブロードキャスト（差分化） |
| `explosion` | `Explosion` | 爆発イベント（即時配信、VFX用） |
| `chat` | `ChatMessage` | チャットメッセージ |
| `gameEnd` | `{ roomId: string, winners, results }` | ゲーム終了。winners は `"red" \| "blue" \| "draw"` |
| `error` | `{ message: string }` | エラー通知（Room not found / Invalid password / Room is full など） |
| `pong` | `{ timestamp: number }` | Ping 応答 |

---

## 型定義

```typescript
type Vector2 = { x: number; y: number };
type Team = "red" | "blue" | null;
type ItemType = "medic" | "ammo" | "heart" | "bomb" | "rope" | "boots";
type WallType = "wall" | "bush" | "water" | "house" | "oneway";

type RoomOptions = {
  teamSelect: boolean;
  instantKill: boolean;
  noItemRespawn: boolean;
  noShooting: boolean;
};

type Item = {
  id: string;
  x: number;
  y: number;
  type: ItemType;
  spawnedAt: number;     // スポーン時刻 Unix ms
};

type Wall = {
  x: number;
  y: number;
  width: number;
  height: number;
  type?: WallType;       // 省略時は "wall"
  direction?: "up" | "down" | "left" | "right"; // oneway の場合のみ
};

type Flag = {
  team: Team;
  x: number;
  y: number;
  carrierId: string | null;
  droppedById?: string;  // 即座再取得防止用
};

type LobbyState = {
  rooms: RoomSummary[];
  onlinePlayers: { id: string; name: string }[];
  currentLobbyId: string;
  availableLobbies: string[];
};

type RoomState = {
  roomId: string;
  roomName: string;
  mapId: string;
  room: RoomSummary;
  players: PlayerSummary[];
  bullets: BulletPublic[];
  projectiles: BulletPublic[];
  explosions: Explosion[];
  timeLeftSec: number;
  gameMode: "deathmatch" | "ctf";
  teamScores: { red: number; blue: number };
  mapData?: MapData;     // 差分プロトコル化により通常tickでは省略される
  items: Item[];
  flags?: Flag[];        // CTF モードのみ
};

type RoomInitState = {
  roomId: string;
  roomName: string;
  mapId: string;
  room: RoomSummary;
  mapData: MapData;
  gameMode: "deathmatch" | "ctf";
};

type PlayerSummary = {
  id: string;
  name: string;
  team: Team;
  roomId: string | null;
  position: Vector2;
  target: Vector2 | null;
  moveQueue: Vector2[];
  hp: number;
  ammo: number;
  score: number;
  deaths: number;
  kills: number;
  hits: number;
  fired: number;
  nextActionAt: number;          // Unix ms（クールダウン終了時刻）
  actionLockStep: number;        // 残りカウント表示用（0=READY）
  hullAngle: number;
  turretAngle: number;
  respawnAt: number | null;
  respawnCooldownUntil: number | null;
  isHidden: boolean;             // bush 内で隠密中
  hasBomb?: boolean;
  ropeCount?: number;
  bootsCharges?: number;
  ping?: number;
};

type BulletPublic = {
  id: string;
  shooterId: string;
  x: number;
  y: number;
  position: Vector2;
  radius: number;
  startX?: number;
  startY?: number;
  isBomb?: boolean;
  isRope?: boolean;
  isAmmoPass?: boolean;
  isHealPass?: boolean;
  isFlagPass?: boolean;
  flagTeam?: Team;
};

type Explosion = {
  id: string;
  x: number;
  y: number;
  radius: number;
  at: number;            // 発生時刻 Unix ms
};

type ChatMessage = {
  from: string;
  message: string;
  timestamp: number;
  channel?: "global" | "team";
};
```

---

## サーバ権威の検証項目

クライアントの値を信用しない。以下はすべてサーバで計算・検証する。

| 検証内容 | 詳細 |
|---|---|
| 移動距離 | 1回の移動は最大 300px（超えた場合は clamp） |
| クールダウン中の行動 | `cooldownUntil > now` の場合は射撃・移動開始を拒否 |
| 移動中の射撃 | `isMoving === true` の場合は射撃を拒否 |
| 弾薬切れ | `ammo <= 0` かつ bomb 非所持の場合は射撃を拒否 |
| 無敵期間中の被弾 | `respawnCooldownUntil > now` の場合はダメージを受けない |
| フレンドリーファイア | 同チームへのダメージを無効化（自爆は有効） |
| ルーム満員 | `playerIds.size >= maxPlayers` の場合は参加を拒否 |
| パスワード | 不一致の場合は参加を拒否 |
| 壁衝突 | 移動先が壁内部の場合は移動を中断しクールダウン発動 |
| アイテム取得 | タンク半径内に入ったアイテムをサーバ側で判定・適用 |

---

## マルチロビー

利用可能なロビー（`constants.ts` の `AVAILABLE_LOBBIES` で管理）:

| ロビーID | 説明 |
|---|---|
| `"Main Lobby"` | デフォルトのメインロビー |
| `"Sub Lobby 1"` | サブロビー 1 |
| `"Sub Lobby 2"` | サブロビー 2 |

- 各 `PlayerRuntime` は `lobbyId` で所属ロビーを管理
- 各 `Room` も `lobbyId` でロビーに紐付く
- 接続時のデフォルトロビーは `AVAILABLE_LOBBIES[0]`
- `switchLobby` でロビー切り替え時、現在のルームから退出される
- `LobbyState` は同一ロビー内の全プレイヤーにのみ配信

---

## 通信シーケンス（ルーム参加からゲーム終了まで）

```
Client                              Server
  │                                   │
  │── login { name, id? } ──────────▶│ プレイヤー登録 or 再接続
  │◀─ welcome { id } ─────────────────│
  │◀─ lobby { rooms, onlinePlayers } ─│
  │                                   │
  │── createRoom { ..., gameMode } ──▶│ ルーム作成 → lobby ブロードキャスト
  │── joinRoom { roomId } ───────────▶│ チーム割当・スポーン
  │◀─ roomInit { mapData, ... } ──────│ 参加成功（マップ等の初回データ送信）
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
