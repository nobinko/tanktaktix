# 開発ガイド

---

## セットアップ

```bash
# 依存関係インストール
npm install

# 開発サーバ起動（サーバ + クライアント同時）
npm run dev

# ビルド（shared → server → client の順）
npm run build

# 本番起動（ビルド済みが前提）
npm run start
```

### アクセス先

- クライアント: http://localhost:5173
- サーバ: http://localhost:3000（WebSocket: ws://localhost:3000/ws）

---

## ブランチ戦略

| ブランチ | 用途 |
|---|---|
| `main` | 本番。Render にデプロイされる |
| `feat/<機能名>` | 新機能開発 |
| `fix/<内容>` | バグ修正 |
| `docs/<内容>` | ドキュメントのみの変更 |

---

## PR マージ条件

`docs/ACCEPTANCE.md` の判定ルールに従う。

| ランク | 条件 |
|---|---|
| **A（必須）** | すべての A ランク項目を満たすこと。既存 A 項目を壊してはならない |
| **B（推奨）** | 壊さなければ未実装でもマージ可 |
| **C（将来）** | 判定対象外 |

### マージ前チェックリスト

- [ ] `docs/ACCEPTANCE.md` の A ランク項目を手動確認した
- [ ] 変更した機能に対応する `scripts/verify_*.ts` で動作確認した（または新規作成した）
- [ ] `docs/GAME_MECHANICS.md` / `docs/PROTOCOL.md` に影響する変更は該当ドキュメントを更新した

---

## 検証スクリプト

`scripts/` 以下の TypeScript スクリプトで機能を確認できる。
実行前にサーバを起動しておくこと（`npm run dev` または `npm run start`）。

```bash
# 例: 変動クールダウンの検証
npx ts-node scripts/verify_variable_cooldown.ts

# 例: 4vs4 シミュレーション（負荷テスト）
npx ts-node scripts/simulate_4v4.ts
```

| スクリプト | 対応機能 |
|---|---|
| `verify_action_cooldown.ts` | 行動クールダウン（A-6） |
| `verify_variable_cooldown.ts` | 変動移動クールダウン（A-6-EXT） |
| `verify_shooting.ts` | 射撃・弾道・衝突（A-5） |
| `verify_teams.ts` | チーム分け・FF 無効（A-9） |
| `verify_game_end.ts` | ゲーム終了・勝敗判定（A-8） |
| `verify_lobby_chat.ts` | ロビーチャット（A-2-EXT） |
| `verify_lobby_full.ts` | 満員チェック |
| `verify_create_flow.ts` | ルーム作成フロー（A-3） |
| `verify_instant_respawn.ts` | インスタントリスポーン（A-7-EXT） |
| `simulate_4v4.ts` | 8クライアント同時接続テスト |

---

## コードスタイル

- 言語: TypeScript（strict は現在未設定、追って整備予定）
- フォーマッター: 未設定（追って ESLint / Prettier を導入予定）
- コメント: 日本語・英語どちらでも可
- サーバとクライアントで型を共有する場合は必ず `shared/src/index.ts` に定義する

### 注意事項

- **サーバ権威を維持する**: ゲームロジック（移動・弾道・HP・スコア）はすべてサーバで計算する
- **`shared/src/index.ts` を変更したら `docs/PROTOCOL.md` も更新する**
- `server/src/index.ts` の定数（クールダウン値・マップサイズ等）を変更したら `docs/GAME_MECHANICS.md` も更新する
