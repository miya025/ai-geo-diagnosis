# AI GEO診断ツール

AI検索エンジン（Google AI Overviews, ChatGPT Search, Perplexityなど）に**引用されやすいか**を診断するSaaS。

## 特徴

- **URLを貼るだけ** - 面倒な設定は一切不要
- **GEO 5指標で分析** - 情報獲得量・エンティティ明確性・引用形式適合・回答直接性・信頼性
- **Vision対応** - スクリーンショットを撮影し、視覚的な信頼性も評価
- **具体的な改善案** - そのまま使える形で提案

## GEO（Generative Engine Optimization）とは

AI検索エンジンに引用されやすいコンテンツを作るための最適化手法です。従来のSEO（検索順位）とは異なり、**RAGエンジンがソースとして採用するか**を重視します。

### 5つの評価指標

| 指標 | 説明 |
|------|------|
| **Information Gain** | 独自データ・一次体験・具体的数値の含有量 |
| **Entity Clarity** | 主語・述語・固有名詞の関係性の明確さ |
| **Format Suitability** | AIが抜粋しやすい形式（箇条書き・表・ステップ） |
| **Answer Directness** | ファーストビューでの結論提示 |
| **Hallucination Risk** | 曖昧表現の回避・視覚的信頼性 |

## セットアップ

```bash
# 依存関係のインストール
npm install

# 環境変数の設定
cp .env.example .env
# .env に GEMINI_API_KEY を設定

# 開発サーバー起動
npm run dev
```

## 環境変数

| 変数名 | 説明 |
|--------|------|
| `GEMINI_API_KEY` | Google Gemini API キー |

## 技術スタック

- **フロントエンド**: Astro + Tailwind CSS v4
- **バックエンド**: Astro API Routes (Node.js)
- **AI**: Gemini API (gemini-3-pro-preview / gemini-3-flash-preview) + Vision
- **スクレイピング**: Puppeteer + Cheerio

## プロジェクト構成

```
src/
├── layouts/
│   └── Layout.astro       # 共通レイアウト
├── lib/
│   ├── scraper.ts         # Puppeteer + Cheerio スクレイピング
│   └── prompt.ts          # GEO診断プロンプト
├── pages/
│   ├── index.astro        # トップページ
│   └── api/
│       └── diagnose.ts    # 診断API
└── styles/
    └── global.css         # Tailwind CSS
```

## 診断フロー

```
1. URL入力
2. Puppeteerでページレンダリング＆スクリーンショット撮影
3. Cheerioでページ構造を解析（hero/proof/pricing等）
4. スクリーンショット + コンテンツをGeminiに送信
5. GEO 5指標で評価・スコアリング
6. 問題点抽出・改善案生成
7. 結果表示
```

## 出力内容

診断結果には以下が含まれます：

- **GEOスコア** (0-100): AI検索エンジンによる引用確率
- **サマリー**: 引用に値するか否かの断言
- **強み**: AIが引用しやすいと判断した具体的箇所
- **課題**: 致命的な欠陥とその技術的解説・影響度
- **AIシミュレーション**: 実際にAIがどう処理するかのプレビュー

## コマンド

| コマンド | 説明 |
|----------|------|
| `npm run dev` | 開発サーバー起動 (localhost:4321) |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルドプレビュー |

## デプロイ

Vercel対応済み。`@astrojs/vercel`アダプターを使用。

```bash
npm run build
```

## ライセンス

MIT
