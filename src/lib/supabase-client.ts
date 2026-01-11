import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import type { Profile, AnalysisResult } from './supabase-types';

// 環境変数から設定を取得 (PUBLIC_ プレフィックス必須)
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

// Supabaseクライアント（シングルトン）
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ======== プロフィール関連 (Read Only) ========

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

// ======== キャッシュ関連 (Read Only / Utils) ========

/**
 * URLハッシュを生成（SHA-256）
 * キャッシュキーとして使用するため、セキュアなハッシュ関数を使用
 */
export function generateUrlHash(url: string): string {
    return createHash('sha256').update(url).digest('hex');
}

/**
 * コンテンツハッシュを生成（SHA-256）
 * コンテンツの変更検出に使用
 */
export function generateContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * キャッシュから診断結果を取得
 */
export async function getCachedResult(
    urlHash: string,
    contentHash: string,
    language: string = 'ja',
    requiredModel?: string
): Promise<AnalysisResult | null> {
    let query = supabase
        .from('analysis_results')
        .select('*')
        .eq('url_hash', urlHash)
        .eq('content_hash', contentHash)
        .eq('language', language);

    // モデル指定がある場合（Proユーザーは必ず指定される想定）
    if (requiredModel) {
        query = query.eq('model', requiredModel);
    }

    const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        // キャッシュが見つからない場合はnullを返す
        return null;
    }
    return data;
}
