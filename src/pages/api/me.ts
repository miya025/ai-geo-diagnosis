import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { checkAndResetCredits } from '../../lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
    try {
        // Authorizationヘッダーからトークンを取得
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const token = authHeader.substring(7);

        // 環境変数
        const supabaseUrl = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL || '';
        const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

        // 認証済みクライアント作成 (RLS対応のため)
        const authClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: {
                headers: {
                    Authorization: authHeader,
                },
            },
        });

        // Supabaseでユーザー情報を取得
        const { data: { user }, error: authError } = await authClient.auth.getUser();

        if (authError || !user) {
            return new Response(JSON.stringify({ error: 'Invalid token' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // プロフィール取得（30日リセットチェック込み）
        // authClientを渡してRLSを通過させる
        let profile = await checkAndResetCredits(user.id, authClient);

        // プロフィールが存在しない場合（トリガー不整合などで作成されなかった場合）
        // デフォルト値で新規作成して返す
        if (!profile) {
            console.warn(`Profile missing for user ${user.id}. Creating default profile.`);
            const { data: newProfile, error: createError } = await authClient
                .from('profiles')
                .insert({
                    id: user.id,
                    free_credits: 3,
                    is_premium: false,
                    language: 'ja',
                    credits_reset_at: new Date().toISOString()
                })
                .select()
                .single();

            if (createError || !newProfile) {
                // RLSで挿入できない可能性があるため、詳細なエラーをログに出す
                console.error('Failed to create missing profile:', createError);
                throw new Error('Failed to create missing profile');
            }
            profile = newProfile;
        }

        return new Response(JSON.stringify({
            is_premium: profile!.is_premium,
            free_credits: profile!.free_credits,
            email: user.email // 必要であればメールアドレスも返す
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('API Error:', error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
