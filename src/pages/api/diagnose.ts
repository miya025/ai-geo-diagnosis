import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { scrapeUrl } from '../../lib/scraper';
import {
  getSystemPrompt,
  buildGEOPrompt,
  parseJSON,
  type GEODiagnosisResult,
} from '../../lib/prompt';
import {
  supabase,
  getProfile,
  generateUrlHash,
  generateContentHash,
  getCachedResult,
} from '../../lib/supabase-client';
import {
  checkAndResetCredits,
  consumeCredit,
  saveCachedResult,
} from '../../lib/supabase-admin';

export const prerender = false;

// Vision対応のための型定義（Anthropic用）
interface AnthropicContentPart {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

// AIモデル定義（Free = Haiku / Pro = Sonnet）
const AI_MODELS = {
  free: 'claude-haiku-4-5-20251001',      // Claude 4.5 Haiku
  pro: 'claude-sonnet-4-5-20250929',      // Claude 4.5 Sonnet
} as const;

async function callClaudeWithVision(
  apiKey: string,
  prompt: string,
  system: string,
  base64Image?: string,
  isPremium: boolean = false
): Promise<string> {
  const content: AnthropicContentPart[] = [
    { type: 'text', text: prompt }
  ];

  if (base64Image) {
    content.unshift({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: base64Image,
      },
    });
  }

  // Free/Proでモデルを切り替え
  const model = isPremium ? AI_MODELS.pro : AI_MODELS.free;
  console.log(`Using AI model: ${model} (isPremium: ${isPremium})`);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Anthropic API error:', errorText);
    try {
      const errorJson = JSON.parse(errorText);
      throw new Error(errorJson.error?.message || 'Claude API呼び出しに失敗しました');
    } catch {
      throw new Error('Claude API呼び出しに失敗しました / Claude API call failed');
    }
  }

  const data = await response.json();
  const textContent = data.content?.find((c: any) => c.type === 'text')?.text;
  return textContent || '';
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { url, language = 'ja' } = body;

    // URLバリデーション
    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: language === 'en' ? 'Please enter a URL' : 'URLを入力してください' }), {
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
      return new Response(JSON.stringify({ error: language === 'en' ? 'Please enter a valid URL' : '有効なURLを入力してください' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // APIキー確認
    const apiKey = import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: language === 'en' ? 'API configuration error' : 'API設定エラー' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ========================================
    // 認証・クレジット確認（仕様書 Section 2, 10）
    // ========================================
    let isPremium = false;
    let freeCredits = 3;
    let userId: string | null = null;
    let authClient: any = null; // 後でconsumeCreditでも使うため

    // Authorizationヘッダーからトークンを取得
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      const supabaseUrl = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL || '';
      const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

      // 認証済みクライアント作成
      authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      });

      // Supabaseでユーザー情報を取得
      const { data: { user }, error: authError } = await authClient.auth.getUser();

      if (!authError && user) {
        userId = user.id;

        // authClientを渡す必要はなくなった（Adminで実行）
        const profile = await checkAndResetCredits(user.id);

        if (profile) {
          isPremium = profile.is_premium;
          freeCredits = profile.free_credits;

          // 無料ユーザーのクレジット確認
          if (!isPremium) {
            if (freeCredits <= 0) {
              const msg = language === 'en'
                ? 'You have used up your monthly free credits (3). Upgrade to Pro for unlimited diagnosis.'
                : '今月の無料診断回数（3回）を使い切りました。Proプランにアップグレードすると無制限に診断できます。';
              return new Response(JSON.stringify({
                error: msg,
                credits_exhausted: true,
                free_credits: 0
              }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }
        }
      }
    }

    console.log(`Auth check: isPremium=${isPremium}, freeCredits=${freeCredits}, hasUser=${!!userId}`);

    // 【修正】ログイン必須化
    // 仕様書通り、未ログインでの診断は許可しない
    if (!userId) {
      return new Response(JSON.stringify({ error: language === 'en' ? 'Login is required to perform diagnosis.' : '診断を実行するにはログインが必要です。' }), {
        status: 401,
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
      return new Response(JSON.stringify({ error: language === 'en' ? 'Failed to fetch the page. Please check the URL or server load.' : 'ページの取得に失敗しました。URLを確認してください。またはサーバー負荷が高い可能性があります。' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 2: キャッシュチェック
    const urlHash = generateUrlHash(url);
    const contentHash = generateContentHash(lp.bodyText || '');
    console.log('Checking cache:', { urlHash, contentHash });

    // キャッシュ取得条件
    // Proユーザー: Proモデルのキャッシュのみ許可（Free時代のキャッシュは使わない）
    // Freeユーザー: モデル不問（Proのキャッシュがあればラッキー、なければFree）
    const requiredModel = isPremium ? AI_MODELS.pro : undefined;

    const cachedResult = await getCachedResult(urlHash, contentHash, language as string, requiredModel);
    if (cachedResult) {
      console.log('Cache hit! Returning cached result (no credit consumed)');
      return new Response(JSON.stringify({
        summary: cachedResult.advice_data?.summary || '',
        geo_score: cachedResult.overall_score,
        scores: cachedResult.detail_scores,
        strengths: cachedResult.advice_data?.strengths || [],
        issues: cachedResult.advice_data?.issues || [],
        impression: cachedResult.advice_data?.impression || '',
        cached: true,
        is_premium: isPremium,
        free_credits: freeCredits,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 3: GEO診断（マルチモーダル）
    console.log('GEO診断実行中... Language:', language);
    const geoPrompt = buildGEOPrompt(lp, language as 'ja' | 'en');
    const systemPrompt = getSystemPrompt(language as 'ja' | 'en');

    // Vision API呼び出し (スクリーンショットがある場合のみ送信)
    // Free: Haiku / Pro: Sonnet で切替
    const currentModel = isPremium ? AI_MODELS.pro : AI_MODELS.free;
    const geoResult = await callClaudeWithVision(apiKey, geoPrompt, systemPrompt, lp.screenshot, isPremium);
    console.log('--- AI RAW RESPONSE ---\n', geoResult.slice(0, 500) + '...', '\n-----------------------');

    // 結果パース
    const result = parseJSON<GEODiagnosisResult>(geoResult);
    console.log('Parsed Result Keys:', Object.keys(result));
    if (result.strengths) console.log('Strengths count:', result.strengths.length);
    if (result.issues) console.log('Issues count:', result.issues.length);

    // バリデーションとデフォルト値設定
    const isEn = language === 'en';
    if (!result.summary) result.summary = isEn ? "Failed to generate diagnosis summary." : "診断結果の要約生成に失敗しました。";
    if (!Array.isArray(result.strengths)) result.strengths = [];
    if (!Array.isArray(result.issues)) result.issues = [];
    // impressionが生成されなかった場合のフォールバック
    if (!result.impression) {
      if (result.summary && !result.summary.includes("失敗しました") && !result.summary.includes("Failed")) {
        result.impression = result.summary;
      } else {
        const tempScore = typeof result.geo_score === 'number' ? result.geo_score : 50;
        if (isEn) {
          result.impression = tempScore >= 60
            ? "The content includes clear signals for AI. It has a high potential for citation."
            : "The content lacks structural clarity. AI might struggle to prioritize this page.";
        } else {
          result.impression = tempScore >= 60
            ? "コンテンツにはAI向けの明確なシグナルが含まれています。検索結果で引用される可能性が高いでしょう。"
            : "コンテンツの構造や信頼性シグナルが不足しています。AIがこのページを優先的に引用するのは難しいかもしれません。";
        }
      }
    }

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

    // Step 4: キャッシュに保存
    try {
      await saveCachedResult(
        urlHash,
        contentHash,
        result.geo_score,
        result.scores,
        {
          summary: result.summary,
          strengths: result.strengths,
          issues: result.issues,
          impression: result.impression,
        },
        language as string,
        currentModel
      );
      console.log('Result cached successfully');
    } catch (cacheError) {
      console.error('Cache save error (non-fatal):', cacheError);
    }

    // Step 5: クレジット消費（無料ユーザーのみ、キャッシュヒット時は消費しない）
    let newFreeCredits = freeCredits;
    if (userId && !isPremium) {
      const consumed = await consumeCredit(userId);
      if (consumed) {
        newFreeCredits = freeCredits - 1;
        console.log(`Credit consumed. Remaining: ${newFreeCredits}`);
      }
    }

    // ブラックボックス化（フロントエンドで制御するためAPIでは全データを返す）
    // Index.astro側で無料ユーザーの場合は2つ目以降をCSSマスクする仕様に変更
    // 【修正】ただし、詳細スコア（Structure以外）はソースコードから見えないようにAPI側で隠蔽（0にする）
    if (!isPremium && result.scores) {
      // Structureはそのまま
      // Context, Freshness, Credibility は隠蔽しないとコピーできてしまうため、ダミー値(0)にする
      // フロントエンド側でマスク表示の下は "???" に書き換える
      result.scores.context = 0;
      result.scores.freshness = 0;
      result.scores.credibility = 0;

      // 【修正】アドバイスの隠蔽
      // 無料ユーザーには「Structure」カテゴリのアドバイスを「1つだけ」返す
      if (result.issues && result.issues.length > 0) {
        const structureIssues = result.issues.filter(i => i.category?.toLowerCase() === 'structure');
        // Structureがあればその先頭1つ、なければ空にする
        result.issues = structureIssues.slice(0, 1);
      } else {
        result.issues = [];
      }
    }

    return new Response(JSON.stringify({
      ...result,
      is_premium: isPremium,
      free_credits: newFreeCredits,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    // エラー詳細はサーバーログにのみ記録（クライアントには露出しない）
    console.error('Diagnosis error:', error instanceof Error ? error.message : 'Unknown error');
    // リクエストボディから言語を取得できない場合のフォールバックは日本語
    // (bodyのパース自体が失敗した場合など)
    return new Response(JSON.stringify({ error: '診断中にエラーが発生しました。/ An error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
