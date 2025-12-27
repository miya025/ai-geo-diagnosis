import type { APIRoute } from 'astro';
import { scrapeUrl } from '../../lib/scraper';
import {
  buildUnderstandingPrompt,
  buildPersonaPrompt,
  buildIssuesPrompt,
  buildImprovementPrompt,
  parseJSON,
  type DiagnosisResult,
} from '../../lib/prompt';

export const prerender = false;

async function callClaude(apiKey: string, prompt: string, system: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Claude API error:', errorText);
    throw new Error('Claude API呼び出しに失敗しました');
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
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

    // Step 0: スクレイピング
    let lp;
    try {
      lp = await scrapeUrl(url);
    } catch (error) {
      console.error('Scraping error:', error);
      return new Response(JSON.stringify({ error: 'ページの取得に失敗しました。URLを確認してください。' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = 'あなたはLP診断の専門家です。指示に従ってJSON形式で出力してください。余計な説明は不要です。';

    // Step 1: 内容理解
    console.log('Step 1: 内容理解...');
    const understandingPrompt = buildUnderstandingPrompt(lp);
    const understandingResult = await callClaude(apiKey, understandingPrompt, systemPrompt);

    // Step 2: ペルソナ視点分析
    console.log('Step 2: ペルソナ視点分析...');
    const personaPrompt = buildPersonaPrompt(lp, understandingResult);
    const personaResult = await callClaude(apiKey, personaPrompt, systemPrompt);

    // Step 3: 問題点抽出
    console.log('Step 3: 問題点抽出...');
    const issuesPrompt = buildIssuesPrompt(personaResult);
    const issuesResult = await callClaude(apiKey, issuesPrompt, systemPrompt);

    // Step 4: 改善案生成
    console.log('Step 4: 改善案生成...');
    const improvementPrompt = buildImprovementPrompt(issuesResult, lp);
    const finalResult = await callClaude(apiKey, improvementPrompt, systemPrompt);

    // 結果パース
    const result = parseJSON<DiagnosisResult>(finalResult);

    // バリデーション
    if (!result.summary || !Array.isArray(result.strengths) || !Array.isArray(result.issues) || !result.impression) {
      throw new Error('診断結果の形式が不正です');
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Diagnosis error:', error);
    return new Response(JSON.stringify({ error: '診断中にエラーが発生しました' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
