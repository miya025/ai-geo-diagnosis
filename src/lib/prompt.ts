import type { StructuredLP } from './scraper';

// ペルソナ定義（行動ベース）
export const PERSONAS = {
  quickScanner: {
    name: '3秒判断ユーザー',
    behavior: [
      'LPを3秒で見るか判断する',
      'スクロールせず上部だけで判断する',
      '「結局何ができるの？」が口癖',
      '長文は絶対に読まない',
    ],
  },
  skeptic: {
    name: '疑い深いユーザー',
    behavior: [
      '「本当に大丈夫？」と常に疑う',
      '誇張表現を見つけると一気に冷める',
      '会社情報・実績・根拠を探す',
      '「で、誰がやってるの？」が口癖',
    ],
  },
  comparator: {
    name: '比較検討ユーザー',
    behavior: [
      '他社との違いを知りたい',
      '価格と機能のバランスを見る',
      '「他と何が違うの？」が口癖',
      '無料お試しや保証を重視',
    ],
  },
  confused: {
    name: '迷子になりやすいユーザー',
    behavior: [
      '専門用語があると離脱する',
      '次に何をすればいいかわからないと不安',
      '「難しそう...」と感じると諦める',
      'シンプルな説明を求める',
    ],
  },
  emotional: {
    name: '共感重視ユーザー',
    behavior: [
      '「自分のことだ」と感じたい',
      'ビフォーアフターを想像したい',
      '他の人の声・体験談を重視',
      '感情で決めて、理屈で正当化する',
    ],
  },
};

// Step 1: 内容理解プロンプト
export function buildUnderstandingPrompt(lp: StructuredLP): string {
  return `以下のLP情報を分析し、内容を理解してください。

## LP構造データ
${JSON.stringify(lp, null, 2)}

## 出力形式（JSON）
{
  "service": "何のサービス/商品か（1文）",
  "target": "誰向けか（1文）",
  "mainValue": "主な価値提案（1文）",
  "priceModel": "価格モデル（無料/有料/不明）",
  "trustLevel": "信頼性要素の充実度（高/中/低）",
  "clarity": "わかりやすさ（高/中/低）"
}

JSONのみ出力してください。`;
}

// Step 2: ペルソナ視点プロンプト
export function buildPersonaPrompt(lp: StructuredLP, understanding: string): string {
  const personaList = Object.values(PERSONAS)
    .map(p => `【${p.name}】\n${p.behavior.map(b => `- ${b}`).join('\n')}`)
    .join('\n\n');

  return `以下のLPを5つのペルソナの視点で評価してください。

## LP理解
${understanding}

## LP構造データ
${JSON.stringify(lp, null, 2)}

## 5つのペルソナ
${personaList}

## 出力形式（JSON）
{
  "personas": [
    {
      "name": "ペルソナ名",
      "firstImpression": "3秒での第一印象",
      "concerns": ["不安・疑問点1", "不安・疑問点2"],
      "positives": ["良いと感じた点"],
      "dropOffRisk": "離脱リスク（高/中/低）",
      "dropOffReason": "離脱する理由"
    }
  ]
}

5人分のペルソナ評価をJSONで出力してください。`;
}

// Step 3: 問題点抽出プロンプト
export function buildIssuesPrompt(personaAnalysis: string): string {
  return `以下のペルソナ分析結果から、LPの問題点を抽出してください。

## ペルソナ分析結果
${personaAnalysis}

## 出力形式（JSON）
{
  "criticalIssues": [
    {
      "title": "問題点タイトル",
      "description": "なぜ問題か",
      "affectedPersonas": ["影響を受けるペルソナ名"],
      "impact": "ユーザー行動への影響",
      "priority": "高/中/低"
    }
  ],
  "strengths": [
    {
      "title": "良い点タイトル",
      "description": "なぜ良いか"
    }
  ]
}

重複を排除し、優先度順に並べてください。JSONのみ出力。`;
}

// Step 4: 改善案生成プロンプト
export function buildImprovementPrompt(issues: string, lp: StructuredLP): string {
  return `以下の問題点に対する具体的な改善案を生成してください。

## 問題点
${issues}

## 現在のLP情報
- ヘッドライン: ${lp.hero.headline}
- サブヘッドライン: ${lp.hero.subHeadline}
- CTA: ${lp.ctas.join(', ')}

## 出力形式（JSON）
{
  "summary": "全体評価の要約（2〜3文）",
  "strengths": ["良い点1", "良い点2"],
  "issues": [
    {
      "title": "問題点",
      "description": "なぜ問題か",
      "impact": "ユーザーへの影響",
      "suggestion": "具体的な改善案（そのまま使える形で）"
    }
  ],
  "impression": "一般消費者の率直な感想（1文）",
  "confidence": {
    "level": "高/中/低",
    "limitations": ["この診断の限界点"]
  }
}

改善案は「〜した方がいい」ではなく「〜に変更する」のように具体的に。
JSONのみ出力。`;
}

export interface DiagnosisResult {
  summary: string;
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
