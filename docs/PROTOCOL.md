\# Protocol (WebSocket) Working Agreement



この文書は、WebSocket メッセージ仕様の運用ルールを定義する。

\*\*ここを“凍結場所（freeze point）”として扱う\*\*。



\## 原則

\- 既存クライアント/サーバとの互換性を最優先する

\- サーバ権威の判定（特に衝突判定）を維持する

\- 互換破壊が必要な変更は、必ず明示的に version を上げる



\## 互換破壊が必要な場合のルール

1\. メッセージ version をインクリメントする

2\. 旧 version 受信時の扱いを定義する

&nbsp;  - 変換（adapter/mapper）で吸収する

&nbsp;  - または graceful fail（致命傷にせず理由をログ出力）

3\. 段階移行計画を明記する（新旧混在期間 / 廃止予定タイミング）

4\. `docs/ACCEPTANCE.md` の互換性要件を満たす



\## Envelope 形式（暫定）

> 現行実装の正確な shape が未確認のため、以下は\*\*暫定\*\*。

> TODO: 実コード（`shared` の型定義）から確定し、本節を更新する。



```json

{

&nbsp; "v": 1,

&nbsp; "t": "message\_type",

&nbsp; "ts": 1730000000000,

&nbsp; "payload": {}

}

