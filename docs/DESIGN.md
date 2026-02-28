# Tank Taktix Design Concept

## Grand Concept: War Room Command Table

Tank Taktix のビジュアルは「薄暗い司令室の戦術テーブル」を基調とする。
古びた地図、真鍮の計器、羊皮紙の命令書が並ぶ空間。
デジタル感を排除し、手触りのある、温かく重厚な世界観を目指す。

### Influence: Pre-2000s Magic: The Gathering

2000年以前のMTGカードが持つ質感をUIに取り込む:
- 深みのあるアースカラー（ゴールド、ブラウン、ダークグリーン、クリムゾン）
- 装飾的なカードフレームのようなボーダー処理
- 羊皮紙のような温かみのあるテキストカラー
- 「手で描かれた」ような有機的な印象
- セリフ体フォントによる古典的な格調

### Influence: Military / Tactical

戦車ゲームとしてのアイデンティティ:
- オリーブドラブ、カーキ、アースカラーの配色
- ステンシル風のHUD表示
- 戦術マップ上の座標表示的なUI
- 機能性と視認性を最優先した堅実なレイアウト

---

## Color Palette

### Base

| Token | Hex | Usage |
|-------|-----|-------|
| `bg-dark` | `#1a1510` | ページ背景、キャンバス外背景 |
| `bg-mid` | `#2a2318` | パネル内背景、入力欄 |
| `bg-gradient-top` | `#2e2820` | radial-gradient の中心色 |
| `panel-bg` | `rgba(42,35,24,0.92)` | パネル背景（半透明） |
| `panel-bg-solid` | `#32291e` | モーダル等のソリッド背景 |
| `canvas-bg` | `#1e1a14` | ゲームフィールド背景 |

### Borders

| Token | Hex | Usage |
|-------|-----|-------|
| `border-gold` | `#b8963e` | プライマリボーダー（MTGカードフレーム風） |
| `border-bronze` | `#8b6f3a` | セカンダリボーダー |
| `border-dark` | `#5c4a2a` | 控えめなボーダー、入力欄 |

### Text

| Token | Hex | Usage |
|-------|-----|-------|
| `text-primary` | `#e8dcc8` | メインテキスト（羊皮紙色） |
| `text-secondary` | `#a89878` | サブテキスト（カーキ） |
| `text-muted` | `#6b5d4a` | 無効化テキスト |
| `text-accent` | `#d4a843` | アクセント（ゴールド） |
| `text-title` | `#c9a84c` | タイトル用ゴールド |

### Buttons

| Token | Value | Usage |
|-------|-------|-------|
| `btn-primary-bg` | `linear-gradient(180deg, #6b7d44, #5c6b3a)` | プライマリボタン（オリーブ） |
| `btn-primary-border` | `#7a8c4e` | プライマリボタン枠 |
| `btn-secondary-bg` | `#3a3228` | セカンダリボタン |
| `btn-secondary-border` | `#5c4a2a` | セカンダリボタン枠 |
| `btn-danger-bg` | `#8b2e2e` | デンジャーボタン |
| `btn-danger-border` | `#a33a3a` | デンジャーボタン枠 |

### Team Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `team-red` | `#c44040` | レッドチーム基本色 |
| `team-red-bright` | `#d45555` | レッドチーム（自分/強調） |
| `team-blue` | `#4a6a8a` | ブルーチーム基本色（スチールブルー） |
| `team-blue-bright` | `#5a82a8` | ブルーチーム（自分/強調） |

### Game State

| Token | Hex | Usage |
|-------|-----|-------|
| `hp-high` | `#5c8a3a` | HP高（オリーブグリーン） |
| `hp-mid` | `#c49832` | HP中（アンバー） |
| `hp-low` | `#a83a2e` | HP低 |
| `bullet` | `#d4a843` | 弾丸（ゴールドトレーサー） |
| `explosion-inner` | `rgba(212,168,67,*)` | 爆発フラッシュ |
| `explosion-outer` | `rgba(184,80,30,*)` | 爆発外縁 |

### World / Map

| Token | Hex | Usage |
|-------|-----|-------|
| `grid` | `rgba(184,150,62,0.06)` | グリッドライン |
| `wall-fill` | `#4a4035` | 壁（塗り） |
| `wall-stroke` | `#6b5d4a` | 壁（線） |
| `bush` | `rgba(90,120,50,0.4)` | ブッシュ |
| `water` | `rgba(70,100,120,0.4)` | 水 |
| `house-fill` | `#6b4420` | 建物 |
| `oneway` | `rgba(200,160,60,0.4)` | 一方通行 |

---

## Typography

| Context | Font | Fallback | Weight |
|---------|------|----------|--------|
| ゲームタイトル | Cinzel Decorative | serif | 700 |
| セクションヘッダー | Cinzel | serif | 400-700 |
| 本文 / ボタン / 入力 | Bitter | serif | 400-700 |
| HUD / チャット / 戦術要素 | Share Tech Mono | monospace | 400 |

---

## Design Principles

### Do (やること)

- **温かみ優先**: アースカラー、ゴールド、ブロンズを基調にする
- **質感を出す**: ベタ塗りではなく、微妙なグラデーションやボーダーで奥行きを表現
- **読みやすさ確保**: コントラスト比を維持しつつ、テキストは羊皮紙色
- **フォントで個性**: セリフ体（Cinzel）とモノスペース（Share Tech Mono）の組み合わせで軍事×古典を演出
- **ゲーム性を最優先**: デザインのために視認性を犠牲にしない

### Don't (やらないこと)

- **青→シアンのグラデーション禁止**: AI生成感の最大要因
- **ネオンカラー禁止**: 蛍光色は世界観に合わない
- **ブラー/グラスモーフィズム禁止**: デジタル感が強すぎる
- **角丸16px以上禁止**: パネルは8px以下で堅実に
- **Segoe UI / sans-serif デフォルト禁止**: 必ず指定フォントを使う
- **過度な装飾禁止**: MTGの影響は「質感」であって「派手さ」ではない
