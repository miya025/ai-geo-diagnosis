import { createClient, SupabaseClient } from '@supabase/supabase-js';

// 環境変数から設定を取得
const supabaseUrl = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

// Supabaseクライアント（シングルトン）
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 型定義
export interface Profile {
    id: string;
    is_premium: boolean;
    free_credits: number;
    credits_reset_at: string | null;
    language: 'ja' | 'en';
    created_at: string;
}

export interface AnalysisResult {
    id: string;
    url_hash: string;
    content_hash: string;
    overall_score: number;
    detail_scores: {
        structure: number;
        context: number;
        freshness: number;
        credibility: number;
    };
    advice_data: any;
    created_at: string;
}

// ======== プロフィール関連 ========

/**
 * ユーザープロフィールを取得
 */
export async function getProfile(userId: string, client?: SupabaseClient): Promise<Profile | null> {
    const s = client || supabase;
    const { data, error } = await s
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error('Error fetching profile:', error);
        return null;
    }
    return data;
}

/**
 * 30日ローリング制限チェック + クレジットリセット
 * - credits_reset_at から30日経過していたらクレジットを3に戻す
 */
export async function checkAndResetCredits(userId: string, client?: SupabaseClient): Promise<Profile | null> {
    const s = client || supabase;
    const profile = await getProfile(userId, s);
    if (!profile) return null;

    const now = new Date();
    const resetAt = profile.credits_reset_at ? new Date(profile.credits_reset_at) : null;

    // リセット日が未設定 or 30日経過している場合
    if (!resetAt || now.getTime() - resetAt.getTime() > 30 * 24 * 60 * 60 * 1000) {
        const newResetAt = now.toISOString();
        const { data, error } = await s
            .from('profiles')
            .update({ free_credits: 3, credits_reset_at: newResetAt })
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            console.error('Error resetting credits:', error);
            return profile;
        }
        return data;
    }

    return profile;
}

/**
 * クレジットを消費（1減らす）
 */
export async function consumeCredit(userId: string, client?: SupabaseClient): Promise<boolean> {
    const s = client || supabase;
    const profile = await checkAndResetCredits(userId, s);
    if (!profile) return false;

    if (profile.is_premium) {
        // Proユーザーは無制限
        return true;
    }

    if (profile.free_credits <= 0) {
        return false; // クレジット不足
    }

    const { error } = await s
        .from('profiles')
        .update({ free_credits: profile.free_credits - 1 })
        .eq('id', userId);

    if (error) {
        console.error('Error consuming credit:', error);
        return false;
    }

    return true;
}

// ======== キャッシュ関連 ========

/**
 * URLハッシュを生成
 */
export function generateUrlHash(url: string): string {
    // 簡易ハッシュ（本番ではSHA-256を使う）
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        const char = url.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

/**
 * コンテンツハッシュを生成
 */
export function generateContentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

/**
 * キャッシュから診断結果を取得
 */
export async function getCachedResult(urlHash: string, contentHash: string, language: string = 'ja'): Promise<AnalysisResult | null> {
    const { data, error } = await supabase
        .from('analysis_results')
        .select('*')
        .eq('url_hash', urlHash)
        .eq('content_hash', contentHash)
        .eq('language', language)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        // キャッシュが見つからない場合はnullを返す
        return null;
    }
    return data;
}

/**
 * 診断結果をキャッシュに保存
 */
const supabaseServiceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * Server-side only: Get Supabase Admin client (Service Role)
 * Used to bypass RLS for background tasks like caching diagnosis results.
 */
export function getSupabaseAdmin() {
    if (!supabaseServiceRoleKey) {
        console.warn('SUPABASE_SERVICE_ROLE_KEY is missing. Falling back to anonymous client.');
        return supabase;
    }
    return createClient(supabaseUrl, supabaseServiceRoleKey);
}

/**
 * 診断結果をキャッシュに保存
 * Note: RLSを回避するため Service Role (Admin) クライアントを使用する
 */
export async function saveCachedResult(
    urlHash: string,
    contentHash: string,
    overallScore: number,
    detailScores: any,
    adviceData: any,
    language: string = 'ja',
    client?: SupabaseClient
): Promise<void> {
    // If a client is provided (e.g., authenticated user client), use it.
    // Otherwise, try to use the admin client.
    const supabaseClient = client || getSupabaseAdmin();

    const { error } = await supabaseClient
        .from('analysis_results')
        .insert({
            url_hash: urlHash,
            content_hash: contentHash,
            overall_score: overallScore,
            detail_scores: detailScores,
            advice_data: adviceData,
            language: language
        });

    if (error) {
        console.error('Error saving cache:', error);
    }
}
