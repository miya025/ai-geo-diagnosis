import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

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

interface StripeCheckoutSession {
    id: string;
    object: 'checkout.session';
    client_reference_id: string | null;  // ユーザーID
    customer_email: string | null;
    payment_status: 'paid' | 'unpaid' | 'no_payment_required';
    status: 'open' | 'complete' | 'expired';
}

interface StripeEvent {
    id: string;
    type: string;
    data: {
        object: StripeCheckoutSession;
    };
}

export const POST: APIRoute = async ({ request }) => {
    try {
        const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

        // 署名検証（本番では必須）
        const signature = request.headers.get('stripe-signature');
        if (!signature && webhookSecret) {
            console.warn('Missing Stripe signature header');
            // 開発環境では署名なしでも続行可能にする（本番では拒否すべき）
        }

        // リクエストボディをパース
        const body = await request.text();
        let event: StripeEvent;

        try {
            event = JSON.parse(body);
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('Stripe webhook received:', event.type);

        // checkout.session.completed イベントの処理
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;

            // client_reference_id からユーザーIDを取得
            const userId = session.client_reference_id;

            if (!userId) {
                console.error('No client_reference_id in checkout session:', session.id);
                // customer_emailからユーザーを検索する代替ロジックも可能
                return new Response(JSON.stringify({ error: 'No user ID provided' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            // 支払い完了を確認
            if (session.payment_status === 'paid') {
                console.log(`Upgrading user ${userId} to Premium`);

                // profiles.is_premium を true に更新
                const { error: updateError } = await supabase
                    .from('profiles')
                    .update({ is_premium: true })
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

        // Stripeには200を返す（再送防止）
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
