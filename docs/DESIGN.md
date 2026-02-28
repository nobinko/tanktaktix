# Tank Taktix Design Concept

## Grand Concept: Visibility-First Tactical Interface (TankMatch-Inspired)

Tank Taktix のビジュアルは「ゲーム戦術テーブルと UI が一つの光学空間」を基調とする。
明るい背景（ベージュ/クリーム）、強いコントラスト（ダークテキスト）、明確なフレーム（パネル枠線）で、
すべての情報が即座に認識できる設計。

**戦術ゲームの本質** — プレイヤーが一瞬で状況判断できる UI が必須。
暗い画面、曖昧なボタン、読めない HUD は敵。

---

## Design Philosophy

### Do (やること)

- **高コントラスト優先**: 暗いテキスト × 明るい背景（WCAG AA 以上）
- **統一パレット**: ゲーム世界と UI が同じ色体系（分離感がない）
- **フレーム構造**: タン系の枠線でパネルを明確に定義（TankMatch 風）
- **情報即座**: 重要な情報は色 × 大きさ × 位置で強調
- **ゲーム性最優先**: デザインのため視認性を犠牲にしない

### Don't (やらないこと)

- **低コントラスト禁止**: テキストが読めない設計は NG
- **分離設計禁止**: ゲーム × UI がバラバラに見える色使い（統一感破壊）
- **曖昧なボタン禁止**: クリック対象が不明確
- **過度な装飾禁止**: フレーム/枠線は定義が目的（見栄えではない）
- **ダーク UI 禁止**: 視認性が必ず低下する

---

## Color Palette

### Base / Background

| Token | Hex | Usage |
|-------|-----|-------|
| `bg-light` | `#f0e8d8` | ページ背景、キャンバス外 |
| `bg-mid` | `#e5dcd0` | パネル、入力欄 |
| `canvas-bg` | `#e8e0d4` | ゲームフィールド |
| `panel-solid` | `#dcccc0` | モーダル、ソリッドパネル |

### Borders / Frames

| Token | Hex | Usage |
|-------|-----|-------|
| `border-gold` | `#a89468` | プライマリボーダー |
| `border-tan` | `#8a7348` | セカンダリボーダー |
| `border-dark` | `#6b5a48` | 入力欄ボーダー |

### Text

| Token | Hex | Usage | Contrast |
|-------|-----|-------|----------|
| `text-primary` | `#3a2a1a` | メインテキスト | 7:1 on light |
| `text-secondary` | `#7a6a5a` | サブテキスト | 5:1 on light |
| `text-muted` | `#9a8a7a` | 無効化テキスト | 3:1 |
| `text-accent` | `#8a6a2a` | アクセント | warm gold |
| `text-title` | `#6b4a1a` | タイトル | strong |

### Buttons

| Role | BG | Border | Text |
|------|-------|--------|------|
| Primary | `#d4c4b0` | `#a89468` | `#3a2a1a` |
| Secondary | `#e5dcd0` | `#8a7348` | `#3a2a1a` |
| Danger | `#d45555` | `#a83a3a` | `#fff` |

### Game State

| State | Hex | Usage |
|-------|-----|-------|
| Team Red | `#c44040` / bright: `#ff5555` | チームカラー |
| Team Blue | `#4a6a8a` / bright: `#6a92c8` | チームカラー |
| HP High | `#5c8a3a` | オリーブグリーン |
| HP Mid | `#d4a832` | アンバー |
| HP Low | `#c83a2e` | 赤 |
| Bullet | `#c4843a` | ゴールド |

### World / Map

| Element | Hex | Usage |
|---------|-----|-------|
| Grid | `rgba(160,130,80,0.08)` | グリッド（薄い） |
| Wall | `#c4b4a0` fill + `#8a7a68` stroke | 壁 |
| Bush | `rgba(90,120,50,0.5)` | ブッシュ |
| Water | `rgba(70,100,120,0.5)` | 水 |
| House | `#c4a070` | 建物 |
| Oneway | `rgba(180,140,40,0.5)` | 一方通行 |

### HUD / Canvas UI

| Element | Hex | Usage |
|---------|-----|-------|
| Minimap BG | `rgba(229,220,208,0.80)` | ミニマップ背景 |
| Chat BG | `rgba(229,220,208,0.85)` | チャット背景 |
| Chat Text | `#3a2a1a` | チャットテキスト |

---

## Typography

| Context | Font | Weight | Color |
|---------|------|--------|-------|
| Title | Cinzel Decorative | 700 | `#6b4a1a` |
| Headers | Cinzel | 400-700 | `#6b4a1a` |
| Body/Buttons | Bitter | 400-700 | `#3a2a1a` |
| HUD/Tactical | Share Tech Mono | 400 | `#3a2a1a` |

---

## Design Principles

### Accessibility First
- WCAG AA コンプライアンス（7:1 コントラスト比）
- 色覚多様性への対応（赤/青チームが識別可能）
- 小さいテキストでも読める

### Unified Aesthetic
- ゲーム世界と UI が同じパレット
- 分離感がない、一つの光学空間
- フレーム/枠線で論理的に領域を定義

### Tactical Clarity
- 情報即座（重要度で色を階層化）
- 状況判断が瞬時（高コントラスト）
- 誤クリック防止（ボタンが明確）
