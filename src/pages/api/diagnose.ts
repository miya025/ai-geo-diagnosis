import type { APIRoute } from 'astro';
import { scrapeUrl } from '../../lib/scraper';
import {
  GEO_SYSTEM_PROMPT,
  buildGEOPrompt,
  parseJSON,
  type GEODiagnosisResult,
} from '../../lib/prompt';

export const prerender = false;

// Vision対応のための型定義
interface MessageContent {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

async function callClaudedWithVision(apiKey: string, prompt: string, system: string, base64Image?: string): Promise<string> {
  const content: MessageContent[] = [
    { type: 'text', text: prompt }
  ];

  if (base64Image) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: base64Image,
      },
    });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929', // Claude Sonnet 4.5 (最新・最高精度)
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Claude API error:', errorText);
    try {
      const errorJson = JSON.parse(errorText);
      throw new Error(errorJson.error?.message || 'Claude API呼び出しに失敗しました');
    } catch {
      throw new Error('Claude API呼び出しに失敗しました');
    }
  }

  const data = await response.json();
  const textContent = data.content?.find((c: any) => c.type === 'text')?.text;
  return textContent || '';
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { url } = body;

    // URLバリデーション
    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'URLを入力してください' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return new Response(JSON.stringify({ error: '有効なURLを入力してください' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // APIキー確認
    const apiKey = import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API設定エラー' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 1: スクレイピング（Puppeteer & Screenshot）
    console.log('Scraping URL:', url);
    let lp;
    try {
      lp = await scrapeUrl(url);
    } catch (error) {
      console.error('Scraping error:', error);
      return new Response(JSON.stringify({ error: 'ページの取得に失敗しました。URLを確認してください。またはサーバー負荷が高い可能性があります。' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 2: GEO診断（マルチモーダル）
    console.log('GEO診断実行中...');
    const geoPrompt = buildGEOPrompt(lp);

    // Vision API呼び出し (スクリーンショットがある場合のみ送信)
    const geoResult = await callClaudedWithVision(apiKey, geoPrompt, GEO_SYSTEM_PROMPT, lp.screenshot);
    console.log('--- AI RAW RESPONSE ---\n', geoResult.slice(0, 500) + '...', '\n-----------------------');

    // 結果パース
    const result = parseJSON<GEODiagnosisResult>(geoResult);
    console.log('Parsed Result Keys:', Object.keys(result));
    if (result.strengths) console.log('Strengths count:', result.strengths.length);
    if (result.issues) console.log('Issues count:', result.issues.length);

    // バリデーションとデフォルト値設定
    if (!result.summary) result.summary = "診断結果の要約生成に失敗しました。";
    if (!Array.isArray(result.strengths)) result.strengths = [];
    if (!Array.isArray(result.issues)) result.issues = [];
    if (!result.impression) result.impression = "AIによる評価コメントの生成に失敗しました。";

    // geo_scoreのバリデーション（0-100の範囲）
    if (typeof result.geo_score !== 'number' || result.geo_score < 0 || result.geo_score > 100) {
      // scoresがあればそこから平均を算出
      if (result.scores) {
        const values = Object.values(result.scores).filter(v => typeof v === 'number');
        if (values.length > 0) {
          result.geo_score = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
        } else {
          result.geo_score = 50;
        }
      } else {
        result.geo_score = 50; // デフォルト値
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Diagnosis error:', error);
    return new Response(JSON.stringify({ error: `診断中にエラーが発生しました: ${error instanceof Error ? error.message : 'Unknown error'}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
