import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../../lib/supabase-admin';

export const prerender = false;

/**
 * Stripe Customer Portal セッション作成エンドポイント
 * 
 * Proユーザーがサブスクリプション管理（キャンセル、支払い方法変更など）を
 * 行うためのStripe Customer Portal URLを生成する。
 */
export const POST: APIRoute = async ({ request, url }) => {
    const stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
        return new Response(JSON.stringify({ error: 'Server configuration error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const stripe = new Stripe(stripeSecretKey, {
        typescript: true,
    });

    // 認証チェック
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const supabaseUrl = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseAnonKey) {
        return new Response(JSON.stringify({ error: 'Server configuration error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 認証済みクライアント作成
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: {
            headers: {
                Authorization: authHeader,
            },
        },
    });

    // Supabaseでユーザー情報を取得・検証
    const { data: { user }, error: authError } = await authClient.auth.getUser();

    if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // DBからstripe_customer_idを取得
        const supabaseAdmin = getSupabaseAdmin();
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('stripe_customer_id, is_premium')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return new Response(JSON.stringify({ error: 'Profile not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!profile.is_premium) {
            return new Response(JSON.stringify({ error: 'Not a Pro user' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!profile.stripe_customer_id) {
            return new Response(JSON.stringify({ error: 'No Stripe customer ID found' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Stripe Customer Portalセッション作成
        const origin = url.origin;
        const session = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: `${origin}/`,
        });

        return new Response(JSON.stringify({ url: session.url }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error('Stripe Customer Portal Error:', err);
        return new Response(JSON.stringify({ error: 'Failed to create portal session' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
