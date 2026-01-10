
import type { APIRoute } from 'astro';
import { supabase, checkAndResetCredits } from '../../lib/supabase';

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

        // Supabaseでユーザー情報を取得
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);

        if (authError || !user) {
            return new Response(JSON.stringify({ error: 'Invalid token' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // プロフィール取得（30日リセットチェック込み）
        const profile = await checkAndResetCredits(user.id);

        if (!profile) {
            return new Response(JSON.stringify({ error: 'Profile not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(JSON.stringify({
            is_premium: profile.is_premium,
            free_credits: profile.free_credits,
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
