# TankTaktix テストドキュメント体系

本ディレクトリは TankTaktix の品質保証および仕様検証に関するドキュメントを管理します。

## ディレクトリ構成

- **[spec/](./spec/)**: コンポーネント別のテスト仕様書。恒久的な検証項目を定義します。
- **[reports/](./reports/)**: テスト実施結果の履歴。日付別に検証結果を記録します。
- **scripts/**: プロジェクトルートの `scripts/` にある各種検証用オートメーションスクリプトを使用します。

## ドキュメント一覧

### テスト仕様 (Specifications)
| ドキュメント | 対象内容 | ランク |
|---|---|---|
| [core.md](./spec/core.md) | 基本移動、戦闘、クールダウン、HP/弾薬 | Aランク |
| [multiplayer.md](./spec/multiplayer.md) | 8v8 (16人接続) 安定性、同期、負荷 | Bランク |
| [modes.md](./spec/modes.md) | CTF (Capture The Flag)、デスマッチ | A/Bランク |
| [items.md](./spec/items.md) | アイテム取得/制限、AIMアクション（パス）、特殊フラッグ挙動 | Cランク |

### 実施レポート (Execution Reports)
- [2026-02-22](./reports/2026-02-22.md): 8v8 負荷試験および最新仕様の再検証結果

## テストの実行方法
詳細は各スクリプトのソースファイルを参照してください。

```bash
# CTF挙動の検証
npx tsx scripts/verify_ctf.ts

# 8v8 多人数戦の負荷シミュレーション
npx tsx scripts/simulate_8v8.ts

# 基本メカニクスの自動検証
npx tsx scripts/verify_game_mechanics.ts
```
