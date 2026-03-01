# WebSocket プロトコル仕様

このドキュメントは TankTaktix の WebSocket メッセージ仕様を定義する。
**ソース of truth は `shared/src/index.ts`**。型定義と本ドキュメントに乖離が生じた場合はコードを優先すること。

---

## 基本仕様

- エンドポイント: `ws(s)://<host>/ws`
- フォーマット: JSON テキストフレーム
- エンベロープ: `{ "type": string, "payload": any }`

### 互換性ルール

- 既存クライアント/サーバとの互換性を最優先する
- サーバ権威の判定（衝突・HP・スコア計算）を維持する
- 互換破壊が必要な変更は `shared/src/index.ts` の型を更新し、本ドキュメントも同時に改訂する

---

## クライアント → サーバ (C→S)

| type | payload | 説明 |
|---|---|---|
| `login` | `{ name: string, id?: string }` | ログイン。name は最大16文字。id は再接続用（B-3） |
| `requestLobby` | なし | ロビー状態を要求する |
| `createRoom` | `{ roomId, name, mapId, maxPlayers, timeLimitSec, gameMode?, password? }` | ルーム作成。roomId が既存の場合はエラー |
| `joinRoom` | `{ roomId: string, password?: string }` | ルーム参加 |
| `leaveRoom` | なし | ルームから退出してロビーへ戻る |
| `move` | `{ target: Vector2 }` | クリック移動。移動中・クールダウン中でも予約として受け付ける |
| `moveCancelOne` | なし | 移動キューの末尾を1つキャンセル（Zキー相当） |
| `shoot` | `{ direction: Vector2 }` | 射撃。direction は単位ベクトル |
| `chat` | `{ message: string }` | チャット送信。最大120文字。ルーム内ならルームへ、ロビーならロビー全体へ配信 |
| `stopMove` | なし | 移動キューを全クリアして即座に停止する |
| `aim` | `{ direction: Vector2 }` | AIMモード中の砲塔方向を更新する。direction は単位ベクトル |
| `useItem` | `{ item: string, direction: Vector2 }` | AIMアクション派生。item は `"rope"` / `"ammo"` / `"heal"` / `"flag"` |
| `spectateRoom` | `{ roomId: string, password?: string }` | ルームに観戦者として参加する |
| `selectTeam` | `{ team: "red" | "blue" }` | チーム選択オプションが有効な部屋での入室後のチーム決定 |

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
  options?: RoomOptions; // 特殊ルールセット
}

// RoomOptions の詳細
type RoomOptions = {
  teamSelect?: boolean;
  instantKill?: boolean;
  noItemRespawn?: boolean;
  noShooting?: boolean;
};
```

---

## サーバ → クライアント (S→C)

| type | payload | 説明 |
|---|---|---|
| `welcome` | `{ id: string }` | 接続時 + ログイン成功時に送信。id はプレイヤーID |
| `lobby` | `LobbyState` | ロビー状態。ルーム一覧 |
| `room` | `RoomState` | ゲーム状態。20Hz(50ms)ごとにブロードキャスト |
| `explosion` | `Explosion` | 爆発イベント（即時配信、VFX用） |
| `chat` | `ChatMessage` | チャットメッセージ |
| `gameEnd` | `{ roomId: string, winners, results }` | ゲーム終了。winners は `"red" | "blue" | "draw"` |
| `leaderboard` | `{ players: PlayerSummary[] }` | リーダーボード（将来用途） |
| `error` | `{ message: string }` | エラー通知（Room not found / Invalid password / Room is full など） |

---

## 型定義

### Vector2
```typescript
type Vector2 = { x: number; y: number };
```

### Team
```typescript
type Team = "red" | "blue" | null;
```

### ItemType / WallType
```typescript
type ItemType = "medic" | "ammo" | "heart" | "bomb" | "rope" | "boots";
type WallType = "wall" | "bush" | "water" | "house" | "oneway";
```

### Item
```typescript
type Item = {
  id: string;
  x: number;
  y: number;
  type: ItemType;
  spawnedAt: number;     // スポーン時刻 Unix ms
};
```

### Wall
```typescript
type Wall = {
  x: number;
  y: number;
  width: number;
  height: number;
  type?: WallType;       // 省略時は "wall"
  direction?: "up" | "down" | "left" | "right"; // onewayの場合のみ使用
};
```

### Flag
```typescript
type Flag = {
  team: Team;            // "red" | "blue"
  x: number;
  y: number;
  carrierId: string | null;  // 持っているプレイヤーの ID（null = 設置中）
  droppedById?: string;      // 旗を落としたプレイヤーの ID（即再取得防止用）
};
```

### MapData
```typescript
type MapData = {
  id: string;
  width: number;
  height: number;
  walls: Wall[];
  spawnPoints: { team: Team; x: number; y: number }[];
  flagPositions?: { team: Team; x: number; y: number }[]; // CTF旗の初期位置（省略時はspawnPointsを使用）
};
```

### LobbyState
```typescript
type LobbyState = {
  rooms: RoomSummary[];
  onlinePlayers: { id: string; name: string }[];
};
```

### RoomSummary
```typescript
type RoomSummary = {
  id: string;
  name: string;
  roomName: string;
  gameMode: "deathmatch" | "ctf";
  mapId: string;
  mapData?: MapData;       // マップ同期用（現在は全量送信）
  maxPlayers: number;
  timeLimitSec: number;
  passwordProtected: boolean;
  createdAt: number;       // Unix ms
  endsAt: number;          // Unix ms
  ended: boolean;
  players: string[];       // プレイヤーID一覧
  playerCount: number;
  spectatorCount?: number; // 観戦者数
  options?: RoomOptions;   // 適用中のオプションルール
  teamStats?: {            // チームの現在人数とスコア（CTFまたはTeam Select有効時）
    red: { count: number; score: number };
    blue: { count: number; score: number };
  };
};
```

### RoomState
```typescript
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
  mapData: MapData;
  items: Item[];
  flags?: Flag[];          // CTF モードのみ
};
```

### BulletPublic
```typescript
type BulletPublic = {
  id: string;
  shooterId: string;
  x: number;
  y: number;
  position: Vector2;
  radius: number;
  startX?: number;
  startY?: number;
  isBomb?: boolean;       // ボムショット
  isRope?: boolean;       // ロープ射出
  isAmmoPass?: boolean;   // 弾薬パス
  isHealPass?: boolean;   // 回復パス
  isFlagPass?: boolean;   // 旗パス
  flagTeam?: Team;        // 旗パス時のチーム
};
```

### PlayerSummary
```typescript
type PlayerSummary = {
  id: string;
  name: string;
  team: Team;
  roomId: string | null;
  position: Vector2;
  target: Vector2 | null;    // 移動キュー先頭（目標地点）
  moveQueue: Vector2[];       // 予約済み移動地点
  hp: number;                 // 0〜100
  ammo: number;               // 0〜20（アイテムで最大40）
  score: number;
  deaths: number;
  kills: number;
  hits: number;
  fired: number;
  nextActionAt: number;       // Unix ms（クールダウン終了時刻）
  actionLockStep: number;     // 残りカウント表示用（0=READY）
  hullAngle: number;          // 車体向き（ラジアン）
  turretAngle: number;        // 砲塔向き（ラジアン）
  respawnAt: number | null;   // リスポーン予定時刻（現在未使用）
  respawnCooldownUntil: number | null; // 無敵期間終了時刻
  isHidden: boolean;          // bush 内で隠密中（B-5）
  // Phase 4: 新アイテム所持状態
  hasBomb?: boolean;          // bomb所持中（true = 次の1発がボムショットになる）
  ropeCount?: number;         // rope所持本数（0〜2）
  bootsCharges?: number;      // boots残り回数（0 = 未所持, 1〜3 = 残り）
};
```

### Explosion
```typescript
type Explosion = {
  id: string;
  x: number;
  y: number;
  radius: number;  // 爆発半径（現在は 40px 固定）
  at: number;      // 発生時刻 Unix ms
};
```

### ChatMessage
```typescript
type ChatMessage = {
  from: string;     // 送信者名
  message: string;
  timestamp: number;
};
```

---

## サーバ権威の検証項目

サーバは以下をすべてサーバ側で計算・検証する。クライアントの値を信用しない。

| 検証内容 | 詳細 |
|---|---|
| 移動距離 | 1回の移動は最大 300px（超えた場合は clamp） |
| クールダウン中の行動 | `cooldownUntil > now` の場合は射撃・移動開始を拒否 |
| 移動中の射撃 | `isMoving === true` の場合は射撃を拒否 |
| 弾薬切れ | `ammo <= 0` の場合は射撃を拒否 |
| 無敵期間中の被弾 | `respawnCooldownUntil > now` の場合はダメージを受けない |
| フレンドリーファイア | 同チームへのダメージを無効化（自爆は有効） |
| ルーム満員 | `playerIds.size >= maxPlayers` の場合は参加を拒否 |
| パスワード | 不一致の場合は参加を拒否 |
| 壁衝突 | 移動先が壁内部の場合は移動を中断しクールダウン発動 |
| アイテム取得 | タンク半径内に入ったアイテムをサーバ側で判定・適用 |

---

*本ドキュメントは `shared/src/index.ts` の型定義に準拠する。変更時は必ず両方を更新すること。*
