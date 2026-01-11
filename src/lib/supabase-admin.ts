import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from './supabase-types';
import { getProfile } from './supabase-client';

// 環境変数 (SERVER SIDE ONLY)
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * Server-side only: Get Supabase Admin client (Service Role)
 * Used to bypass RLS for background tasks and sensitive updates.
 */
export function getSupabaseAdmin() {
    if (!supabaseServiceRoleKey) {
        console.error('SUPABASE_SERVICE_ROLE_KEY is missing. Admin operations will fail.');
        // Fallback or throw? For now fallback to prevent crash, but operations will fail if RLS is strict.
        // しかし、セキュリティ修正のため strictly fail した方が良いが、
        // 既存コードの挙動を壊さないよう createClient はする（ただし権限不足になる可能性）
        return createClient(supabaseUrl, 'key-missing');
    }
    return createClient(supabaseUrl, supabaseServiceRoleKey);
}

/**
 * 30日ローリング制限チェック + クレジットリセット
 * - credits_reset_at から30日経過していたらクレジットを3に戻す
 * - Admin権限で実行する（ユーザーによる改ざん防止）
 */
export async function checkAndResetCredits(userId: string): Promise<Profile | null> {
    const admin = getSupabaseAdmin();

    // プロフィール取得（Admin権限）
    const { data: profile, error: fetchError } = await admin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (fetchError || !profile) {
        console.error('Error fetching profile (admin):', fetchError);
        return null;
    }

    const now = new Date();
    const resetAt = profile.credits_reset_at ? new Date(profile.credits_reset_at) : null;

    // リセット日が未設定 or 30日経過している場合
    if (!resetAt || now.getTime() - resetAt.getTime() > 30 * 24 * 60 * 60 * 1000) {
        const newResetAt = now.toISOString();
        const { data, error } = await admin
            .from('profiles')
            .update({ free_credits: 3, credits_reset_at: newResetAt })
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            console.error('Error resetting credits:', error);
            // エラー時は古いプロフィールを返すがログに残す
            return profile;
        }
        return data as Profile;
    }

    return profile as Profile;
}

/**
 * クレジットを消費（1減らす）
 * - Admin権限で実行する
 */
export async function consumeCredit(userId: string): Promise<boolean> {
    const admin = getSupabaseAdmin();

    // まずリセットチェック（これ自体がAdminで行われる）
    const profile = await checkAndResetCredits(userId);
    if (!profile) return false;

    if (profile.is_premium) {
        // Proユーザーは無制限
        return true;
    }

    if (profile.free_credits <= 0) {
        return false; // クレジット不足
    }

    // Admin権限で減算
    const { error } = await admin
        .from('profiles')
        .update({ free_credits: profile.free_credits - 1 })
        .eq('id', userId);

    if (error) {
        console.error('Error consuming credit:', error);
        return false;
    }

    return true;
}

/**
 * 診断結果をキャッシュに保存
 * - Admin権限で実行する
 */
export async function saveCachedResult(
    urlHash: string,
    contentHash: string,
    overallScore: number,
    detailScores: any,
    adviceData: any,
    language: string = 'ja',
    model: string
): Promise<void> {
    const admin = getSupabaseAdmin();

    const { error } = await admin
        .from('analysis_results')
        .insert({
            url_hash: urlHash,
            content_hash: contentHash,
            overall_score: overallScore,
            detail_scores: detailScores,
            advice_data: adviceData,
            language: language,
            model: model
        });

    if (error) {
        console.error('Error saving cache:', error);
    }
}
