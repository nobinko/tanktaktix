# TankTaktix ドキュメント

TankTaktix は Node.js + TypeScript のリアルタイム多人数タンクシューター。
サーバ権威モデル、20Hz tick、WebSocket JSON 同期。

**コードと本ドキュメントに乖離がある場合は常にコードを優先すること。**

---

## AIへの読み方ガイド

タスクの種類に応じて読むべきファイルを示す。

| タスク | 読むべきファイル |
|---|---|
| 射撃・ダメージ・クールダウンの実装・変更 | `domain/combat.md` |
| 移動・旋回・カメラの実装・変更 | `domain/movement.md` |
| アイテム・AIMアクションの実装・変更 | `domain/items.md` |
| マップ・地形・CTF旗の実装・変更 | `domain/maps.md` |
| WebSocketメッセージ・型定義の変更 | `domain/network.md` |
| UI・デザイン・サウンドの実装・変更 | `domain/ui.md` |
| ロビー・ルーム・再接続・ゲームモードの変更 | `domain/session.md` |
| システム全体の構成・アーキテクチャの確認 | `architecture.md` |
| 設計判断の理由を確認・変更前の意図確認 | `decisions.md` |
| 進捗確認・残タスク確認 | `roadmap.md` |
| PR・マージの可否確認 | `acceptance.md` |
| 開発環境・ブランチ・スクリプト | `contributing.md` |

---

## ドキュメントマップ

```
docs/
├── INDEX.md              # ← いまここ
├── inbox.md              # アイデア雑多受け（フォーマット不要）
├── decisions.md          # 設計判断ログ（なぜそう決めたか）
├── roadmap.md            # Phase進捗
├── acceptance.md         # 受入条件（A/B/Cランク）
├── architecture.md       # システム構成・内部型・定数・デプロイ・スケーリング
├── contributing.md       # セットアップ・ブランチ・スクリプト
│
├── domain/               # ドメイン別仕様（実装の Source of Truth）
│   ├── combat.md         # 射撃・ダメージ・クールダウン・HP・リスポーン
│   ├── movement.md       # 移動・ピボットターン・カメラ
│   ├── items.md          # アイテム種別・スポーン・AIMアクション
│   ├── maps.md           # マップ一覧・地形・隠密・CTF旗
│   ├── network.md        # WebSocketプロトコル・型定義・サーバ権威
│   ├── ui.md             # デザイン・カラー・フォント・SE・アセット戦略
│   └── session.md        # ゲームモード・ルームオプション・ロビー・再接続
│
├── test/
│   ├── README.md
│   ├── spec/             # テスト仕様
│   └── reports/          # テスト実行レポート
│
└── archive/              # 歴史的参照（読む必要はほぼない）
    ├── deep-research-report.md
    ├── phase3_summary.md
    └── WALKTHROUGH.md
```

---

## プロジェクト概要

| 項目 | 内容 |
|---|---|
| ゲームジャンル | リアルタイム多人数タクティカルタンクシューター |
| プレイスタイル | ブラウザ（Canvas 2D） |
| サーバ | Node.js + Express + WebSocket（ws） |
| 共有型 | `@tanktaktix/shared` |
| デプロイ | Render.com |
| 現在のフェーズ | Phase 5 進行中（`roadmap.md` を参照） |

---

## 制約（すべての実装で守ること）

- ゲームロジック（移動・弾道・HP・スコア）はすべてサーバで計算する
- `shared/src/index.ts` の型を変更したら `domain/network.md` も更新する
- `server/src/constants.ts` の定数を変更したら対応する domain/ ファイルも更新する
- 距離ベース AOI は採用しない（`decisions.md` DEC-004 参照）
- BGM は実装しない（`decisions.md` DEC-005 参照）
