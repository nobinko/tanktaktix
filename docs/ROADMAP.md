# TankTaktix Project Roadmap

## Current Project Status (2026-02-17)
**State:** Phase 1 (Server Core & Critical Fixes) COMPLETE. Moved to Phase 2 (MVP Verification).
**Latest Changes:**
- Fixed critical bugs: Bullet collision, Friendly fire, Result screen logic, Room persistence.
- Merged `feat/canvas-hud` to `main`.
- **Fixed tank color logic**: Self tank now matches team color (Red/Blue).
**Next Action:** Verify MVP requirements (A-Rank items in `docs/ACCEPTANCE.md`) before starting Phase 3 features.

---

## Phase 1: Server Core & Bug Fixes (Completed)
サーバーの基本機能実装と、主要なクリティカルバグの修正フェーズ。
- [x] 弾丸の衝突判定ロジックの修正（回転矩形判定）
- [x] フレンドリーファイア（同士討ち無効）ルールの実装
- [x] 「ゲーム結果が間違った部屋に表示される」問題の修正
- [x] パフォーマンス低下（3ゲーム目以降のラグ）の調査と修正
- [x] 「弾丸が即座に爆発する」問題の修正
- [x] リザルト画面の改善（ゲーム停止、ポップアップ、ボタン配置）
- [x] 終了したルームをロビー一覧から非表示にする <!-- 追加調整完了 -->
- [x] スコアリングルールの調整（チーム戦仕様: Kill+1, Hit/Deathなし）
- [x] チームスコアの永続化（プレイヤーが抜けても点数を維持） <!-- 追加調整完了 -->
- [x] リザルトでの勝敗判定修正と、退室プレイヤーの履歴表示 <!-- 修正完了 -->
- [x] 自機の色がチームカラーと異なる問題の修正 <!-- 本日完了 -->

## Phase 2: MVP Requirements Verification (Current Focus)
`docs/ACCEPTANCE.md` の Aランク（Must）項目の網羅的検証。
- [ ] **ゲームサイクル検証**
  - [ ] A-1 ~ A-3: ログイン、ロビー、ルーム作成/参加の堅牢性確認
  - [x] A-8: ゲーム終了判定とリザルト（修正済みだが要再確認）
  - [ ] A-11: チャット機能の動作確認
- [ ] **対戦アクション検証**
  - [ ] A-4: 移動（クリック、予約、キャンセル）の挙動確認
  - [ ] A-5: 射撃と弾道、壁衝突
  - [ ] A-6: 行動カウント（5→0）と硬直時間の正確性
  - [ ] A-7: HP/弾薬の増減とリスポーン処理
- [/] **チーム戦・視点**
  - [/] A-9: Red/Blue チーム分けとスポーン位置 (チーム色修正済み)
  - [ ] A-10: 視点操作（矢印キー、ズーム）

## Phase 3: "Should" Features Implementation (Next Steps)
Bランク（推奨）項目の実装。ゲーム性を高めるための追加機能。
- [ ] **B-1: アイテム実装**
  - [ ] メディカルキット / アモ / ボム / 他
- [ ] **B-2: 障害物の多様化**
  - [ ] ブッシュ（隠蔽）、水場（通行不可・弾通過）、破壊可能壁など
- [ ] **B-3 ~ B-6: その他機能**
  - [ ] 再接続処理（Rejoin）
  - [ ] フラッグ戦ルール
  - [ ] 観戦モード

## Phase 4: Future Features (Later)
Cランク項目。
- [ ] マップエディタ / 外部マップロード
- [ ] ミニマップの高度な機能
