import type { APIRoute } from 'astro';
import Stripe from 'stripe';

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

    // Get user ID and language from request body
    let userId;
    let language;
    try {
        const body = await request.json();
        userId = body.userId;
        language = body.language;
    } catch (e) {
        // If not JSON or empty.
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
