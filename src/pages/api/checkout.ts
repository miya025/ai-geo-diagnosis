import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

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

    // ========================================
    // 認証チェック（セキュリティ強化）
    // リクエストボディからのuserIdを信頼せず、JWTから検証
    // ========================================
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const token = authHeader.substring(7);
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

    // 認証されたユーザー情報を使用（リクエストボディからは取得しない）
    const userId = user.id;
    const email = user.email;

    // リクエストボディから言語設定のみ取得
    let language: string | undefined;
    try {
        const body = await request.json();
        language = body.language;
    } catch {
        // リクエストボディがない場合は言語設定なし
    }

    // 1. User Country Detection (Vercel)
    // Local development default 'US' or 'JP'
    const country = request.headers.get('x-vercel-ip-country') || 'US';

    // 2. Select Price ID
    // Logic: Language setting > IP location
    // If language is explicitly 'en', use USD.
    // If language is explicitly 'ja', use JPY.
    // Otherwise, fallback to IP-based country detection.
    let useJpy = false;

    if (language === 'en') {
        useJpy = false;
    } else if (language === 'ja') {
        useJpy = true;
    } else {
        // Fallback to IP location
        useJpy = country === 'JP';
    }

    const priceId = useJpy
        ? (import.meta.env.STRIPE_PRICE_ID_JPY || process.env.STRIPE_PRICE_ID_JPY)
        : (import.meta.env.STRIPE_PRICE_ID_USD || process.env.STRIPE_PRICE_ID_USD);

    if (!priceId) {
        console.error(`Price ID missing for country: ${country}`);
        return new Response(JSON.stringify({ error: 'Price configuration missing' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const origin = url.origin;

    try {
        const session = await stripe.checkout.sessions.create({
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: `${origin}/?success=true`,
            cancel_url: `${origin}/`,
            client_reference_id: userId,
            customer_email: email,
        });

        return new Response(JSON.stringify({ url: session.url }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Stripe Checkout Error:', err);
        return new Response(JSON.stringify({ error: 'Failed to create checkout session' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
