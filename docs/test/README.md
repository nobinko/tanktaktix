# テストドキュメント

このディレクトリは Tank Taktix の仕様確認と検証メモを置く場所です。

## 構成

- `spec/`: 受け入れ仕様
- `reports/`: 実施レポート

## ランタイム地形の検証

曲線地形、map compiler、collision、描画を触ったら次を実行します。

```powershell
npx tsx tasks/verify_geometry_runtime.ts
```

このスクリプトが確認する内容:

- river elbow prefab が `ringSector` にコンパイルされる
- server collision が曲線地形に当たる
- `createRoom()` 後も raw prefab object を保持している
- client world renderer が曲線地形で `arc()` を使う

## ビルド確認

最低限この 3 つを通します。

```powershell
npm run build -w shared
npm run build -w server
npm run build -w client
```
