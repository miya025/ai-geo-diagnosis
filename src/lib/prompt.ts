import type { StructuredLP } from './scraper';

// GEO診断用システムプロンプト
export const GEO_SYSTEM_PROMPT = `# Role
あなたは、Google AI Overviews, ChatGPT Search, Perplexity などの「検索拡張生成（RAG）」エンジンのアルゴリズムシミュレーターです。
ユーザーが入力したWebページの内容（テキストおよびスクリーンショット）を複合的に評価し、**「AIがユーザーの質問に対する回答ソースとして引用するか否か」**を冷徹に判定してください。

# Constraints
- SEO（検索順位）の観点（被リンクやドメインパワーなど）は無視すること。**「テキスト、画像、レイアウトを含むコンテンツ全体の品質と信頼性」**を評価対象とする。
- ユーザーへの気遣いは不要。エンジニアやコンテンツ作成者が即座に修正できる「具体的・技術的」な指摘を行うこと。
- 画像（スクリーンショット）が提供されている場合は、視覚的な信頼性（デザイン、図解の有無、UIの整理状態）も評価に加えること。
- **重要**: 提供されたコードブロック、本文テキスト、見出し構造を必ず確認すること。実際にコードや解決策が存在する場合は「存在しない」と誤診断してはならない。

# Evaluation Criteria (GEO 5つの指標)
以下の基準でコンテンツをスコアリングおよび分析せよ。各指標を0〜100で個別にスコア化すること。

1. **Information Gain (情報獲得量)**: 既存の大手メディアの一般的な記述に対し、このページ固有の「具体的数値」「一次体験」「独自データ」がどれだけ含まれているか。
2. **Entity Clarity (エンティティの明確性)**: 主語、述語、固有名詞の関係性が明確か。ページ構造やデザインから情報の階層が理解しやすいか。見出し構造（h1/h2/h3）が適切に階層化されているか。
3. **Format Suitability (引用形式への適合)**: 箇条書き、比較表、ステップ形式など、AIが回答生成時に「抜粋」しやすいフォーマットが使われているか。コードブロックが適切にマークアップされているか。
4. **Answer Directness (回答の直接性)**: ファーストビューで結論（定義や答え）を提示しているか。無駄なイントロダクションや広告で情報が埋もれていないか。
5. **Hallucination Risk (幻覚リスク / 信頼性)**: 曖昧な表現がないか。外部リンクで根拠を示しているか。デザインが「詐欺的」「低品質」に見えないか。

# Output Schema (JSON Only)
以下のJSON形式のみを出力せよ。マークダウンのコードブロックは不要。

{
  "summary": "AI検索エンジンから見たこのページの評価（150文字以内）。引用に値するか、単なるノイズとして処理されるかを断言する。",
  "geo_score": 0〜100の整数（引用採用確率）,
  "scores": {
    "information_gain": 0〜100,
    "entity_clarity": 0〜100,
    "format_suitability": 0〜100,
    "answer_directness": 0〜100,
    "hallucination_risk": 0〜100
  },
  "strengths": [
    "AIが引用しやすいと感じた具体的な箇所"
  ],
  "issues": [
    {
      "title": "問題点のタイトル",
      "description": "なぜそれがAIにとってマイナスなのかの技術的解説",
      "impact": "大/中/小",
      "suggestion": "具体的な改善方法（コード例や修正手順を含む）"
    }
  ],
  "impression": "【AIシミュレーション】もしユーザーが『[ページのトピック]について教えて』と聞いた時、AIはこのページをこう処理するでしょう：『...』"
}`;

// LP構造をMarkdown形式に変換
export function structuredLPToMarkdown(lp: StructuredLP): string {
  const sections: string[] = [];

  // メタ情報
  if (lp.meta.title) {
    sections.push(`# ${lp.meta.title}`);
  }
  if (lp.meta.description) {
    sections.push(`> ${lp.meta.description}`);
  }

  // Hero
  if (lp.hero.headline) {
    sections.push(`## メインメッセージ\n${lp.hero.headline}`);
  }
  if (lp.hero.subHeadline) {
    sections.push(`${lp.hero.subHeadline}`);
  }

  // 価値提案
  if (lp.valueProps.length > 0) {
    sections.push(`## 主な特徴・価値提案\n${lp.valueProps.map(v => `- ${v}`).join('\n')}`);
  }

  // 社会的証明
  if (lp.proof.stats.length > 0) {
    sections.push(`## 実績・数値データ\n${lp.proof.stats.map(s => `- ${s}`).join('\n')}`);
  }
  if (lp.proof.testimonials.length > 0) {
    sections.push(`## お客様の声\n${lp.proof.testimonials.map(t => `- ${t}`).join('\n')}`);
  }

  // 価格
  if (lp.pricing.displayed && lp.pricing.text) {
    sections.push(`## 料金情報\n${lp.pricing.text}`);
  }

  // FAQ
  if (lp.faq.length > 0) {
    sections.push(`## よくある質問\n${lp.faq.map(f => `- ${f}`).join('\n')}`);
  }

  // CTA
  if (lp.ctas.length > 0) {
    sections.push(`## CTA（行動喚起）\n${lp.ctas.map(c => `- ${c}`).join('\n')}`);
  }

  // 信頼要素
  const trustElements: string[] = [];
  if (lp.trustSignals.hasCompanyInfo) trustElements.push('会社概要あり');
  if (lp.trustSignals.hasPrivacyPolicy) trustElements.push('プライバシーポリシーあり');
  if (lp.trustSignals.hasTokushoho) trustElements.push('特定商取引法表記あり');
  if (lp.trustSignals.hasContact) trustElements.push('問い合わせ先あり');
  if (trustElements.length > 0) {
    sections.push(`## 信頼性要素\n${trustElements.map(t => `- ${t}`).join('\n')}`);
  }

  // 本文テキスト
  if (lp.bodyText && lp.bodyText.length > 0) {
    sections.push(`## 記事本文\n${lp.bodyText}`);
  }

  // コードブロック
  if (lp.codeBlocks && lp.codeBlocks.length > 0) {
    const codeSection = lp.codeBlocks.map((code, i) => `### コードスニペット ${i + 1}\n\`\`\`\n${code}\n\`\`\``).join('\n\n');
    sections.push(`## コードブロック（${lp.codeBlocks.length}個）\n${codeSection}`);
  }

  // 見出し構造
  if (lp.headings && lp.headings.length > 0) {
    const headingsList = lp.headings.map(h => `${'  '.repeat(h.level - 1)}- h${h.level}: ${h.text}`).join('\n');
    sections.push(`## 見出し構造（${lp.headings.length}個）\n${headingsList}`);
  }

  // リンク情報
  if (lp.links && lp.links.length > 0) {
    const internalLinks = lp.links.filter(l => l.type === 'internal');
    const externalLinks = lp.links.filter(l => l.type === 'external');
    let linksSection = '';
    if (internalLinks.length > 0) {
      linksSection += `### 内部リンク（${internalLinks.length}個）\n${internalLinks.slice(0, 10).map(l => `- [${l.text}](${l.url})`).join('\n')}\n\n`;
    }
    if (externalLinks.length > 0) {
      linksSection += `### 外部リンク（${externalLinks.length}個）\n${externalLinks.slice(0, 10).map(l => `- [${l.text}](${l.url})`).join('\n')}`;
    }
    if (linksSection) {
      sections.push(`## リンク情報\n${linksSection}`);
    }
  }

  return sections.join('\n\n');
}

// GEO診断プロンプト生成
export function buildGEOPrompt(lp: StructuredLP): string {
  const markdown = structuredLPToMarkdown(lp);

  return `以下のWebページのコンテンツをGEO（Generative Engine Optimization）の観点から評価してください。
提供されたスクリーンショット画像も参照し、視覚的な信頼性や情報の伝わりやすさも加味して分析してください。

## 対象URL
${lp.url}

## ページコンテンツ（Markdown形式）
${markdown}

上記のコンテンツ（テキストおよび画像）を評価し、指定されたJSON形式で出力してください。`;
}

// 診断結果の型定義
export interface GEODiagnosisResult {
  summary: string;
  geo_score: number;
  scores?: {
    information_gain: number;
    entity_clarity: number;
    format_suitability: number;
    answer_directness: number;
    hallucination_risk: number;
  };
  strengths: string[];
  issues: {
    title: string;
    description: string;
    impact: string;
    suggestion?: string;
  }[];
  impression: string;
}

// LP診断互換の型定義（フロントエンド互換性のため）
export interface DiagnosisResult {
  summary: string;
  geo_score?: number;
  strengths: string[];
  issues: {
    title: string;
    description: string;
    impact: string;
    suggestion?: string;
  }[];
  impression: string;
  confidence?: {
    level: string;
    limitations: string[];
  };
}

export function parseJSON<T>(text: string): T {
  // JSONを抽出（マークダウンのコードブロック対応）
  let jsonStr = text;

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1];
  }

  // 最初の { から最後の } までを抽出
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('JSONのパースに失敗しました');
  }

  return JSON.parse(jsonMatch[0]) as T;
}
