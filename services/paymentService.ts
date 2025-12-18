import { createClient } from '@supabase/supabase-js';
import { ExchangeRateData } from '../types';
import { webhookService } from './webhookService';

const getEnv = (key: string) => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env) return process.env[key];
  } catch (e) {}
  return undefined;
};

const SUPABASE_URL = getEnv('SUPABASE_URL') || getEnv('REACT_APP_SUPABASE_URL') || 'https://sxvqqktlykguifvmqrni.supabase.co';
const SUPABASE_KEY = getEnv('SUPABASE_ANON_KEY') || getEnv('REACT_APP_SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4dnFxa3RseWtndWlmdm1xcm5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDE0MTIsImV4cCI6MjA4MDk3NzQxMn0.5psTW7xePYH3T0mkkHmDoWNgLKSghOHnZaW2zzShkSA';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Zarinpal Merchant ID
const ZARINPAL_MERCHANT_ID = 'd88e96b3-4dcb-4af9-a9d1-9d8755a37a91'; 

// Stripe Secret Key (Test Mode) - REPLACE WITH YOUR OWN KEY
const STRIPE_SECRET_KEY = 'sk_test_placeholder'; 

const TETHERLAND_API_KEY = 'HMcNhotoQfk9d4mWipfQMa54axNogCmpVyWTgWZp';

// 1 USD = 10 Credits
const CREDITS_PER_USD = 10;

// Cache rate for 5 minutes to avoid rate limits
let cachedRate: number | null = null;
let lastFetchTime = 0;

export const paymentService = {
    
    /**
     * Fetches real-time USD (USDT) to IRR (Toman) rate from Tetherland.
     * Returns Price in TOMAN.
     */
    async getUsdToIrrRate(): Promise<number> {
        const now = Date.now();
        // Use cached rate if available and fresh (5 mins)
        if (cachedRate && (now - lastFetchTime < 300000)) {
            return cachedRate;
        }

        const targetUrl = 'https://api.tetherland.com/currencies';
        const timestamp = new Date().getTime();
        
        // Proxy strategies with better error handling & cache busting
        const strategies = [
            {
                name: 'AllOrigins',
                url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}&t=${timestamp}`,
                headers: {}
            },
            {
                name: 'CorsProxy',
                url: `https://corsproxy.io/?${encodeURIComponent(targetUrl)}?t=${timestamp}`,
                headers: {
                    'Authorization': `Bearer ${TETHERLAND_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            },
            {
                name: 'Direct (Fallback)',
                url: targetUrl,
                headers: {
                    'Authorization': `Bearer ${TETHERLAND_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        ];

        for (const strategy of strategies) {
            try {
                console.log(`Fetching rate via ${strategy.name}...`);
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

                const res = await fetch(strategy.url, {
                    method: 'GET',
                    headers: strategy.headers,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (res.status === 429) {
                    console.warn(`Rate limit hit on ${strategy.name}`);
                    continue; 
                }

                if (!res.ok) {
                    console.warn(`${strategy.name} failed with status ${res.status}`);
                    continue; 
                }

                const data = await res.json();
                
                let price = 0;
                // Parse Logic for Tetherland Response Structure
                // Format: { status: 200, data: { currencies: { USDT: { price: ... } } } }
                if (data?.data?.currencies?.USDT?.price) {
                    price = parseFloat(data.data.currencies.USDT.price);
                } 
                // Format: { currencies: { USDT: { price: ... } } } (Sometimes proxy unwraps)
                else if (data?.currencies?.USDT?.price) {
                    price = parseFloat(data.currencies.USDT.price);
                }
                // Format: { contents: "..." } (AllOrigins wrapper if not raw)
                else if (data?.contents) {
                    try {
                        const parsed = JSON.parse(data.contents);
                        if (parsed?.data?.currencies?.USDT?.price) {
                            price = parseFloat(parsed.data.currencies.USDT.price);
                        }
                    } catch (e) {}
                }

                if (!isNaN(price) && price > 0) {
                    cachedRate = price;
                    lastFetchTime = now;
                    console.log(`Rate updated: ${price} Toman`);
                    return price;
                }
            } catch (e) {
                console.error(`Strategy ${strategy.name} error:`, e);
            }
        }

        console.error("All rate fetch strategies failed.");
        if (cachedRate) return cachedRate; // Return stale if available
        
        // Fallback to a realistic hardcoded value (based on provided JSON)
        return 128500; 
    },

    /**
     * Initiates a Zarinpal payment flow.
     */
    async requestZarinpalPayment(amountCredits: number, userEmail: string, userMobile?: string): Promise<string> {
        const tomanRate = await this.getUsdToIrrRate();
        
        // Calculate Toman Amount based on 1 USD = 10 Credits
        const amountToman = Math.ceil(amountCredits * (tomanRate / CREDITS_PER_USD));
        const amountRial = amountToman * 10; // Zarinpal requires Rial

        const callbackUrl = `${window.location.origin}/#/payment/verify`;
        const description = `Purchase ${amountCredits} Credits`;

        // Strict Metadata Construction
        const metadata: any = {};
        if (userEmail && userEmail.trim() !== '') {
            metadata.email = userEmail;
        }
        if (userMobile && userMobile.trim() !== '') {
            metadata.mobile = userMobile;
        }

        const body = {
            merchant_id: ZARINPAL_MERCHANT_ID,
            amount: amountRial,
            currency: "IRR",
            description: description,
            callback_url: callbackUrl,
            metadata: metadata
        };

        const res = await fetch('https://corsproxy.io/?https://payment.zarinpal.com/pg/v4/payment/request.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body)
        });

        const json = await res.json();

        if (json.data && json.data.code === 100) {
            const pendingTx = {
                authority: json.data.authority,
                amountCredits,
                amountRial,
                rate: tomanRate,
                timestamp: Date.now()
            };
            localStorage.setItem(`zp_pending_${json.data.authority}`, JSON.stringify(pendingTx));
            
            // Webhook
            webhookService.send('credit.purchase_started', {
                amount: amountCredits,
                currency: 'IRR',
                gateway: 'Zarinpal',
                authority: json.data.authority
            }, {}, { id: 'pending', email: userEmail }); 

            return `https://payment.zarinpal.com/pg/StartPay/${json.data.authority}`;
        } else {
            let errorMsg = 'Unknown Zarinpal error';
            if (json.errors) {
                if (Array.isArray(json.errors)) {
                    errorMsg = json.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
                } else if (typeof json.errors === 'object') {
                    errorMsg = json.errors.message || JSON.stringify(json.errors);
                } else {
                    errorMsg = String(json.errors);
                }
            } else if (json.message) {
                errorMsg = json.message;
            }
            
            webhookService.send('credit.purchase_failed', { error: errorMsg, gateway: 'Zarinpal' }, {}, { id: 'pending', email: userEmail });

            throw new Error(`Zarinpal Error: ${errorMsg}`);
        }
    },

    /**
     * Initiates a Stripe Checkout Session.
     */
    async requestStripePayment(amountCredits: number, userEmail: string): Promise<string> {
        if (STRIPE_SECRET_KEY === 'sk_test_placeholder') {
            throw new Error("Stripe is not configured. Please set a valid Secret Key in paymentService.ts");
        }

        // 1 USD = 10 Credits
        // Amount in Cents = (amountCredits / 10) * 100 = amountCredits * 10
        const amountCents = Math.floor(amountCredits * 10);
        
        // Minimum Stripe amount is usually 50 cents -> 5 credits
        if (amountCents < 50) {
            throw new Error("Minimum purchase for Stripe is 5 Credits ($0.50).");
        }

        // Construct URLs manually to avoid URL constructor issues in some envs
        const baseUrl = window.location.href.split('#')[0];
        const callbackPath = '#/payment/verify';
        const successUrl = `${baseUrl}${callbackPath}?session_id={CHECKOUT_SESSION_ID}&gateway=stripe`;
        const cancelUrl = `${baseUrl}${callbackPath}?status=canceled&gateway=stripe`;
        
        const params = new URLSearchParams();
        params.append('success_url', successUrl);
        params.append('cancel_url', cancelUrl);
        params.append('payment_method_types[]', 'card');
        params.append('line_items[0][price_data][currency]', 'usd');
        params.append('line_items[0][price_data][product_data][name]', `${amountCredits} AI Credits`);
        params.append('line_items[0][price_data][unit_amount]', amountCents.toString());
        params.append('line_items[0][quantity]', '1');
        params.append('mode', 'payment');
        if (userEmail) params.append('customer_email', userEmail);

        // Call Stripe API directly (Client-side key usage is insecure for production, but standard for this 'builder' architecture request)
        const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        const json = await res.json();
        
        if (!res.ok) {
            throw new Error(json.error?.message || "Stripe Session Creation Failed");
        }

        // Store meta for verification
        localStorage.setItem(`stripe_pending_${json.id}`, JSON.stringify({
            amountCredits,
            timestamp: Date.now()
        }));
        
        webhookService.send('credit.purchase_started', {
            amount: amountCredits,
            currency: 'USD',
            gateway: 'Stripe',
            session_id: json.id
        }, {}, { id: 'pending', email: userEmail });

        return json.url;
    },

    /**
     * Verifies a Zarinpal payment after callback.
     */
    async verifyZarinpalPayment(authority: string, status: string): Promise<{ success: boolean; message: string }> {
        if (status !== 'OK') {
            webhookService.send('credit.purchase_failed', { error: 'Canceled by user', gateway: 'Zarinpal', authority });
            return { success: false, message: "Payment canceled or failed." };
        }

        const pendingJson = localStorage.getItem(`zp_pending_${authority}`);
        if (!pendingJson) {
            return { success: false, message: "Transaction data not found." };
        }
        const pending = JSON.parse(pendingJson);

        const body = {
            merchant_id: ZARINPAL_MERCHANT_ID,
            amount: pending.amountRial,
            authority: authority
        };

        try {
            const res = await fetch('https://corsproxy.io/?https://payment.zarinpal.com/pg/v4/payment/verify.json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(body)
            });

            const json = await res.json();

            if (json.data && (json.data.code === 100 || json.data.code === 101)) {
                const { data: { user } } = await (supabase.auth as any).getUser();
                if (!user) throw new Error("User not authenticated");

                await this.finalizePayment(user.id, {
                    amount: pending.amountCredits,
                    currency: 'IRR',
                    exchangeRate: pending.rate,
                    gateway: 'Zarinpal',
                    paymentId: json.data.ref_id.toString()
                });

                localStorage.removeItem(`zp_pending_${authority}`);

                return { success: true, message: `Payment Verified! Ref ID: ${json.data.ref_id}` };
            } else {
                webhookService.send('credit.purchase_failed', { error: `Verification code ${json.data?.code}`, gateway: 'Zarinpal', authority });
                return { success: false, message: `Verification Failed: Code ${json.data?.code}` };
            }
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            return { success: false, message: errorMessage || "Verification network error" };
        }
    },

    /**
     * Verifies a Stripe payment after callback.
     */
    async verifyStripePayment(sessionId: string): Promise<{ success: boolean; message: string }> {
        if (STRIPE_SECRET_KEY === 'sk_test_placeholder') {
             return { success: false, message: "Stripe configuration missing." };
        }

        try {
            const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
                }
            });

            const session = await res.json();

            if (session.payment_status === 'paid') {
                const pendingJson = localStorage.getItem(`stripe_pending_${sessionId}`);
                
                // Fallback amount calc if local storage missing (e.g. cross-device)
                let amountCredits = 0;
                if (pendingJson) {
                    amountCredits = JSON.parse(pendingJson).amountCredits;
                } else if (session.amount_total) {
                    // Logic: 1 USD = 10 Credits. 
                    // Session Amount is in cents. 100 cents = 1 USD = 10 Credits.
                    // Credits = (Cents / 100) * 10 = Cents / 10.
                    amountCredits = session.amount_total / 10; 
                }

                const { data: { user } } = await (supabase.auth as any).getUser();
                if (!user) throw new Error("User not authenticated");

                await this.finalizePayment(user.id, {
                    amount: amountCredits,
                    currency: session.currency?.toUpperCase() || 'USD',
                    exchangeRate: 1.0, // Base currency
                    gateway: 'Stripe',
                    paymentId: session.payment_intent || session.id
                });

                localStorage.removeItem(`stripe_pending_${sessionId}`);
                return { success: true, message: "Payment Verified Successfully!" };
            } else {
                return { success: false, message: `Payment status: ${session.payment_status}` };
            }
        } catch (e: any) {
            return { success: false, message: e.message || "Stripe verification failed" };
        }
    },

    /**
     * Records the transaction and tops up the user balance.
     */
    async finalizePayment(userId: string, paymentDetails: {
        amount: number;
        currency: string;
        exchangeRate: number;
        gateway: string;
        paymentId: string;
    }): Promise<void> {
        const { error } = await supabase.rpc('process_payment_topup', {
            p_user_id: userId,
            p_amount: paymentDetails.amount,
            p_currency: paymentDetails.currency,
            p_exchange_rate: paymentDetails.exchangeRate,
            p_payment_id: paymentDetails.paymentId,
            p_provider: paymentDetails.gateway
        });

        if (error) throw new Error(`Transaction Record Failed: ${error.message}`);
        
        webhookService.send('credit.purchase_completed', {
            amount: paymentDetails.amount,
            currency: paymentDetails.currency,
            gateway: paymentDetails.gateway,
            paymentId: paymentDetails.paymentId
        }, {}, { id: userId, email: '' });
        
        webhookService.send('credit.added', {
            amount: paymentDetails.amount,
            reason: 'Purchase'
        }, {}, { id: userId, email: '' });
    }
};