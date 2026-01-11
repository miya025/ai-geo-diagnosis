import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../lib/supabase-admin';
import Stripe from 'stripe';

export const prerender = false;

/**
 * Stripe Webhook エンドポイント
 * 
 * Stripe Payment Linkでの支払い完了時に呼び出され、
 * ユーザーのis_premiumフラグをtrueに更新する。
 * 
 * 設定手順:
 * 1. Stripe Dashboard > Developers > Webhooks で新しいエンドポイントを追加
 * 2. URL: https://your-domain.com/api/stripe-webhook
 * 3. イベント: checkout.session.completed を選択
 * 4. Webhook Secretを.envのSTRIPE_WEBHOOK_SECRETに設定
 */

export const POST: APIRoute = async ({ request }) => {
    const signature = request.headers.get('stripe-signature');
    const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
    const stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;

    if (!signature || !webhookSecret) {
        return new Response(JSON.stringify({ error: 'Missing signature or webhook secret' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Stripeクライアントの初期化（署名検証に必要ない場合もあるが、型定義などで使用）
    // 注意: constructEventは静的メソッドなのでインスタンス化しなくても使えるが、
    // 将来的な拡張（API呼び出しなど）のために初期化しておくのが一般的
    if (!stripeSecretKey) {
        console.warn('STRIPE_SECRET_KEY is missing. Webhook verification might fail strictly.');
    }
    const stripe = new Stripe(stripeSecretKey || '', {
        typescript: true,
    });

    const supabaseAdmin = getSupabaseAdmin();

    try {
        const body = await request.text();
        let event: Stripe.Event;

        try {
            // 署名を検証し、イベントオブジェクトを構築
            event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        } catch (err) {
            console.error(`Webhook signature verification failed.`, err);
            return new Response(JSON.stringify({ error: `Webhook Error: ${err instanceof Error ? err.message : 'Unknown'}` }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('Stripe webhook received and verified:', event.type);

        // checkout.session.completed イベントの処理
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object as Stripe.Checkout.Session;
            const customerId = session.customer as string;

            // client_reference_id からユーザーIDを取得
            const userId = session.client_reference_id;

            if (!userId) {
                console.error('No client_reference_id in checkout session:', session.id);
                return new Response(JSON.stringify({ error: 'No user ID provided' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            // 支払い完了を確認
            if (session.payment_status === 'paid') {
                console.log(`Upgrading user ${userId} to Premium`);

                // profiles.is_premium を true に更新し、stripe_customer_id も保存
                const { error: updateError } = await supabaseAdmin
                    .from('profiles')
                    .update({
                        is_premium: true,
                        stripe_customer_id: customerId
                    })
                    .eq('id', userId);

                if (updateError) {
                    console.error('Failed to update premium status:', updateError);
                    return new Response(JSON.stringify({ error: 'Database update failed' }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                console.log(`User ${userId} successfully upgraded to Premium`);
            }
        }


        // customer.subscription.deleted イベントの処理（解約・期限切れ時のダウングレード）
        if (event.type === 'customer.subscription.deleted') {
            const subscription = event.data.object as Stripe.Subscription;
            const customerId = subscription.customer as string;

            if (customerId) {
                console.log(`Processing subscription deletion for customer: ${customerId}`);

                // stripe_customer_id に一致するユーザーの is_premium を false に更新
                const { error: updateError } = await supabaseAdmin
                    .from('profiles')
                    .update({ is_premium: false })
                    .eq('stripe_customer_id', customerId);

                if (updateError) {
                    console.error('Failed to downgrade user:', updateError);
                    // Webhookは200を返すが、ログにはエラーを残す
                } else {
                    console.log(`Successfully downgraded user with customer ID: ${customerId}`);
                }
            }
        }

        return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Stripe webhook error:', error);
        return new Response(JSON.stringify({
            error: `Webhook error: ${error instanceof Error ? error.message : 'Unknown'}`
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
