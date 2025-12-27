# AIユーザー診断

一般消費者の視点を持つAIが、LP・Webサイトを診断し「わかりにくさ・不安・違和感」を言語化するSaaS。

## 特徴

- **URLを貼るだけ** - 面倒な設定は一切不要
- **5つのペルソナで分析** - 3秒判断・疑い深い・比較検討・迷子・共感重視
- **4段階の深層診断** - 構造解析 → ペルソナ評価 → 問題抽出 → 改善案生成
- **具体的な改善案** - そのまま使える形で提案

## セットアップ

```bash
# 依存関係のインストール
npm install

# 環境変数の設定
cp .env.example .env
# .env に ANTHROPIC_API_KEY を設定

# 開発サーバー起動
npm run dev
```

## 環境変数

| 変数名 | 説明 |
|--------|------|
| `ANTHROPIC_API_KEY` | Anthropic API キー |

## 技術スタック

- **フロントエンド**: Astro + Tailwind CSS
- **バックエンド**: Astro API Routes (Node.js)
- **AI**: Claude API (claude-sonnet-4-20250514)
- **スクレイピング**: Cheerio

## プロジェクト構成

```
src/
├── layouts/
│   └── Layout.astro       # 共通レイアウト
├── lib/
│   ├── scraper.ts         # LP構造化スクレイピング
│   └── prompt.ts          # 4ステッププロンプト
├── pages/
│   ├── index.astro        # トップページ
│   └── api/
│       └── diagnose.ts    # 診断API（4ステップ）
└── styles/
    └── global.css         # Tailwind CSS
```

## 診断フロー

```
1. URL入力
2. LP構造分解（hero/proof/pricing等）
3. Step 1: 内容理解
4. Step 2: 5ペルソナ視点分析
5. Step 3: 問題点抽出・優先度付け
6. Step 4: 改善案生成
7. 結果表示
```

## コマンド

| コマンド | 説明 |
|----------|------|
| `npm run dev` | 開発サーバー起動 (localhost:4321) |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルドプレビュー |

## ライセンス

MIT
