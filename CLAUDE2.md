# AI GEO Diagnosis (AI検索診断くん) 実装詳細仕様書 v4.5

## 1. プロジェクト概要

**サービス名:** AI GEO Diagnosis (AI検索診断くん)

**コンセプト:** 「個人ブログが公式ドキュメントやRedditに勝つためのAI最適化ツール」

ドメインパワーに頼らず、AIにとっての「読みやすさ（構造）」と「理解しやすさ（文脈）」を極めることで、AI検索（Perplexity/ChatGPT）での引用獲得を目指す。

**ターゲット:** 個人開発者、テックブロガー、中堅メディア

---

## 2. 認証・ログイン仕様 (Auth Flow)

ユーザーの離脱を防ぎ、診断モチベーションが最高潮の瞬間に登録させる設計。

**認証プロバイダー:** Google OAuth 2.0 (Supabase Auth)

### ログインフロー

**トップページ:**
- 未ログインでもURL入力可
- 「診断する」ボタンも押せる状態にする

**診断実行時:**
- ボタン押下時にシステムが認証状態をチェック
- **未ログイン:** 画面遷移させず、その場でログインモーダルを表示。「結果を保存するためにログインが必要です」と誘導
- **ログイン済み:** 即座に解析フローへ移行

**ログイン後の挙動:**
- マイページには飛ばさない
- `redirectTo: window.location.href` を指定し、元の診断画面に戻して自動的に解析を開始させる（再クリックの手間を省く）

**アカウント作成:**
- SupabaseのTrigger機能により、ユーザー登録と同時に profiles テーブル（無料クレジット3回付与）を自動生成

---

## 3. 診断ロジック：4つの評価軸 (The 4 Pillars)

AIが引用元を選ぶ際のアルゴリズムを逆算した4軸。

**※重要:** 無料ユーザーには「Structure」以外の項目名自体を隠蔽（ブラックボックス化）する。

| 評価軸 (内部用) | 診断内容 (AI視点・技術特化) | ユーザーが直せるアクション |
|---|---|---|
| **① Structure** (構造・機械可読性) | HTMLタグ、リスト、テーブル、Schema.orgの実装状況。「Redditのスレッドよりパースしやすいか？」 | `<h>`タグの階層化、比較表の作成、構造化データの追加 |
| **② Context** (文脈・意味理解) | 固有表現密度（バージョン名等の具体性）、主語の明快さ、論理構成。「公式より具体的で、要約しやすいか？」 | 指示語（あれ・それ）の排除、具体的バージョン/エラーコードの追記 |
| **③ Freshness** (情報の鮮度) | タイムスタンプ、記事内の「時点」特定キーワード。「今のAI（RAG）が最新情報と認識するか？」 | 更新日の明記、本文への「2026年時点」等の追記 |
| **④ Credibility** (信頼性シグナル) | 引用・出典（Outbound Links）、著者情報。「AIがハルシネーション（嘘）と判定しないか？」 | 公式ドキュメントへの発リンク、一次情報（ログ・検証画像）の追加 |

---

## 4. システムアーキテクチャ & 技術スタック

- **Frontend:** Astro (SSR Mode - `output: server`)
- **Backend/DB:** Supabase (Auth, PostgreSQL)
- **AI Engine:** Claude API
  - **Free Logic:** Claude 4.5 Haiku (コスト重視)
  - **Pro Logic:** Claude 4.5 Sonnet (精度・推論能力重視)
- **Payment:** Stripe (Checkout + Webhook)
- **Infra:** Vercel / Cloudflare Pages

---

## 5. データベース設計 (Supabase)

### profiles テーブル (ユーザー管理)

- `id`: uuid (PK)
- `is_premium`: boolean (Default: false)
- `free_credits`: int (Default: 3)
- `language`: text ('ja' or 'en')

### analysis_results テーブル (キャッシュ & ハッシュ判定)

APIコスト削減とリライト検知の核となるテーブル。

- `id`: uuid (PK)
- `url_hash`: text (URLのハッシュ値 / Index)
- `language`: text ('ja' or 'en')
- `content_hash`: text (抽出した本文テキストのMD5/SHA256ハッシュ)
  - ユーザーがリライトしてハッシュが変われば、キャッシュを無効化し再診断を実行
- `overall_score`: int (総合スコア)
- `detail_scores`: jsonb (4軸それぞれのスコア)
- `advice_data`: jsonb (改善アドバイス、修正コード案)
- `created_at`: timestamp

---

## 6. 処理フロー (トークン節約 & ブラックボックス制御)

### Preprocessing (前処理)

Astro APIルートで対象URLをFetch。cheerio 等でHTMLタグ（script, style, nav, footer）を削除し、**「本文テキストのみ」**を抽出。

### Hashing & Cache Check

抽出テキストから `content_hash` を生成し、DBを照会。一致すればAPI代0円。

### API Response Logic (ブラックボックス化)

**無料ユーザーへのレスポンス:**
- Structure のスコアとアドバイスのみ返す
- Context, Freshness, Credibility は **ラベル名（キー）を隠蔽** し、「謎の重要項目A/B/C」としてスコア null、ステータス Critical 等のみを返す
- **狙い:** ユーザーがChatGPT等を使って自力で解決するルートを塞ぐ

---

## 7. 収益化・プラン設計 (Stripe)

**Pro Plan:** 月額 1,980円 ($14.99)

**1,980円設定の理由:** 個人エンジニアが「技術書1冊分」として投資しやすい価格帯。

### Webhookフロー

`checkout.session.completed` 受信 → `profiles.is_premium = true` に更新。即時反映。

---

## 8. UI/UX 仕様

### 地域・言語対応

IP判定 (Edge Middleware) により、JPなら日本語、それ以外は英語をデフォルト表示。

**動画広告は完全廃止。**

### レポート画面の差別化 (ブラックボックス戦略)

| 項目 | 無料ユーザー (Free) | 有料ユーザー (Pro) |
|---|---|---|
| **総合スコア** | 巨大に表示 (D判定などで危機感を煽る) | 詳細表示 |
| **評価軸 1** | ✅ HTML構造 (スコア表示) | ✅ HTML構造 (詳細表示) |
| **評価軸 2** | 🔒 謎の重要指標 A (Critical判定) | 📝 文脈・固有表現 (詳細スコア) |
| **評価軸 3** | 🔒 謎の重要指標 B (Warning判定) | ✨ 情報の鮮度 (詳細スコア) |
| **評価軸 4** | 🔒 謎の重要指標 C (Unknown判定) | 🛡️ 信頼性・権威性 (詳細スコア) |
| **改善アドバイス** | 構造のアドバイス1つのみ | 3つの謎指標を含む全改善案 |
| **コピー** | 「HTMLは完璧ですが、AIに見落とされる致命的な原因があります」 | (なし) |

---

## 9. 開発ロードマップ

**Phase 1 (Core & Auth):**
Astro + Supabase Auth (Modal Flow) で「URL抽出〜Haiku診断〜ブラックボックス結果表示」を実装。

**Phase 2 (Cache):**
analysis_results テーブルの実装と、リライト検知ロジック（ハッシュ比較）の完成。

**Phase 3 (Payment):**
Stripe連携と `is_premium` フラグによる機能制限解除（マスク解除）の実装。

## 10. 実行回数制限

無料プランでは、1ヶ月あたり3回の診断を実行できます。