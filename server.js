require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const path = require('path');
const { exec } = require('child_process');
const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. MIDDLEWARES ---
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enhanced Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    if (req.method === 'POST' && req.path.includes('verify-payment')) {
        console.log('🔍 VERIFY PAYMENT REQUEST:', {
            body: req.body,
            headers: req.headers
        });
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// --- 2. INITIALIZATION ---
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

let razorpay;
if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
    razorpay = new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: RAZORPAY_KEY_SECRET
    });
    console.log('✅ Razorpay initialized with key:', RAZORPAY_KEY_ID.substring(0, 8) + '...');
} else {
    console.error('❌ Razorpay keys missing in .env file!');
}

const ordersStore = new Map();

// --- 3. ROUTES ---

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        razorpay: !!razorpay 
    });
});

// ✅ NEW: Dynamic Cobalt Community Network (Ultimate Bypass for Turnstile/Cloudflare)
app.post('/api/convert-youtube', async (req, res) => {
    const { url } = req.body;
    
    if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
        return res.status(400).json({ success: false, message: 'Valid YouTube URL required' });
    }

    console.log('🔄 Converting YouTube URL via Dynamic Cobalt Network:', url);
    
    try {
        // 1. API se un saare Community Servers ki list nikalna jo abhi ONLINE hain
        let instances = [];
        try {
            const instanceRes = await fetch('https://instances.cobalt.best/api/instances.json');
            if (instanceRes.ok) {
                const instanceList = await instanceRes.json();
                
                // Filter only servers that are currently ONLINE and support API
                instances = instanceList
                    .filter(inst => inst.online && inst.online.api && inst.api)
                    .map(inst => inst.api);
                
                console.log(`📡 Found ${instances.length} active Cobalt community servers.`);
            }
        } catch (e) {
            console.log("⚠️ Could not fetch community instances list.");
        }

        // Backup servers just in case community list fails
        const fallbacks = [
            'https://cobalt-api.kwiatekm.dev',
            'https://api.cobalt.ya3390.com',
            'https://api.cobalt.tools' 
        ];

        // Sabhi servers ko mix (shuffle) karna taaki ek hi server par baar-baar load na pade
        const apiServers = [...new Set([...instances, ...fallbacks])].sort(() => 0.5 - Math.random());

        let finalMediaUrl = null;

        // 2. Loop lagana: Ek server fail ho to dusre par try karna
        for (const apiServer of apiServers) {
            try {
                console.log(`📡 Trying Cobalt API on: ${apiServer}`);
                
                // 4 second se zyada time lage to server chhod do
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000); 
                
                // Naya Cobalt v11 API Endpoint (POST /)
                const response = await fetch(`${apiServer}/`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                    },
                    body: JSON.stringify({
                        url: url,
                        videoQuality: "720"
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (response.ok) {
                    const data = await response.json();
                    
                    // Naye version mein Cobalt 'url' seedha data block me deta hai
                    if ((data.status === 'redirect' || data.status === 'tunnel') && data.url) {
                        finalMediaUrl = data.url;
                        console.log(`✅ Success (v11 API) with server: ${apiServer}`);
                        break; 
                    }
                } else if (response.status === 404 || response.status === 400) {
                    // Agar server naye update par nahi hai, to purana v7 (api/json) try karo
                    const oldResponse = await fetch(`${apiServer}/api/json`, {
                        method: 'POST',
                        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url, vQuality: "720" })
                    });
                    
                    if (oldResponse.ok) {
                        const oldData = await oldResponse.json();
                        if (oldData.url) {
                            finalMediaUrl = oldData.url;
                            console.log(`✅ Success (v7 API) with server: ${apiServer}`);
                            break;
                        }
                    }
                }
            } catch (err) {
                // Ignore error and smoothly shift to the next server
                console.log(`⚠️ ${apiServer} failed, trying next...`);
            }
        }

        // 3. Agar link mil gaya to Frontend ko return kar do
        if (finalMediaUrl) {
            res.json({ success: true, m3u8Url: finalMediaUrl });
        } else {
            throw new Error("All community Cobalt instances failed or blocked the request.");
        }

    } catch (error) {
        console.error(`❌ Complete conversion failure: ${error.message}`);
        res.status(500).json({ 
            success: false, 
            message: 'All servers are currently busy. Please try again in a few seconds.' 
        });
    }
});



// Create Order
app.post('/api/create-order', async (req, res) => {
    try {
        if (!razorpay) {
            throw new Error('Razorpay not configured. Check environment variables.');
        }

        const { amount, currency, receipt } = req.body;
        
        if (!amount || amount < 1) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid amount. Minimum amount is ₹1.' 
            });
        }

        const options = {
            amount: Math.round(amount * 100),
            currency: currency || 'INR',
            receipt: receipt || `rec_${Date.now()}`,
            payment_capture: 1
        };

        console.log('📝 Creating order with options:', options);
        
        const order = await razorpay.orders.create(options);
        
        // Store order for verification
        ordersStore.set(order.id, {
            amount: options.amount,
            currency: options.currency,
            receipt: options.receipt,
            status: 'created',
            created_at: new Date().toISOString()
        });

        console.log('✅ Order created:', order.id);
        
        res.json({ 
            success: true, 
            order,
            message: 'Order created successfully'
        });
        
    } catch (error) {
        console.error('❌ Order Creation Error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Failed to create order'
        });
    }
});

// Verify Payment - FIXED VERSION
app.post('/api/verify-payment', (req, res) => {
    try {
        console.log('🔍 Verification request received');
        
        // Extract with better validation
        const { order_id, payment_id, signature } = req.body;
        
        // ✅ ENHANCED LOGGING
        console.log('📊 Verification Details:', {
            order_id: order_id,
            payment_id: payment_id,
            signature_length: signature ? signature.length : 0,
            signature_first_10: signature ? signature.substring(0, 10) + '...' : 'none',
            request_body_keys: Object.keys(req.body),
            timestamp: new Date().toISOString()
        });
        
        // ✅ VALIDATION WITH BETTER ERROR MESSAGES
        if (!order_id || order_id.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Order ID is required',
                received_order_id: order_id
            });
        }
        
        if (!payment_id || payment_id.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Payment ID is required',
                received_payment_id: payment_id
            });
        }
        
        if (!signature || signature.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Signature is required',
                received_signature_length: signature ? signature.length : 0
            });
        }
        
        if (!RAZORPAY_KEY_SECRET) {
            console.error('❌ RAZORPAY_KEY_SECRET is not configured');
            return res.status(500).json({ 
                success: false, 
                message: 'Server configuration error. Please contact support.' 
            });
        }

        // ✅ ENHANCED SIGNATURE GENERATION
        const body = order_id + "|" + payment_id;
        console.log('🔐 Generating signature for:', body);
        
        const generated_signature = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');
        
        console.log('🔐 Signature Comparison:', {
            received_signature: signature.substring(0, 20) + '...',
            generated_signature: generated_signature.substring(0, 20) + '...',
            full_match: generated_signature === signature,
            key_secret_available: !!RAZORPAY_KEY_SECRET
        });
        
        // ✅ VERIFICATION
        if (generated_signature === signature) {
            console.log('✅ Signature verification SUCCESS for order:', order_id);
            
            // Update order status
            if (ordersStore.has(order_id)) {
                const orderData = ordersStore.get(order_id);
                orderData.status = 'verified';
                orderData.payment_id = payment_id;
                orderData.verified_at = new Date().toISOString();
                ordersStore.set(order_id, orderData);
            }
            
            return res.json({ 
                success: true, 
                message: 'Payment verified successfully',
                order_id: order_id,
                payment_id: payment_id,
                verified_at: new Date().toISOString()
            });
            
        } else {
            console.error('❌ Signature MISMATCH:', {
                order_id: order_id,
                expected_signature_start: generated_signature.substring(0, 20),
                received_signature_start: signature.substring(0, 20),
                possible_issues: [
                    'Wrong RAZORPAY_KEY_SECRET',
                    'Incorrect order_id or payment_id',
                    'Signature tampering'
                ]
            });
            
            return res.status(400).json({ 
                success: false, 
                message: 'Payment verification failed. Invalid signature.',
                debug: {
                    order_id_provided: order_id,
                    payment_id_provided: payment_id,
                    signature_mismatch: true
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Verification Error:', error.stack);
        
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error during verification',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get all orders (for debugging)
app.get('/api/orders', (req, res) => {
    const orders = Array.from(ordersStore.entries()).map(([id, data]) => ({
        id,
        ...data
    }));
    
    res.json({ 
        success: true, 
        count: orders.length,
        orders: orders 
    });
});

// Debug endpoint to check Razorpay configuration
app.get('/api/debug/razorpay', (req, res) => {
    res.json({
        success: true,
        razorpay_configured: !!razorpay,
        key_id_exists: !!RAZORPAY_KEY_ID,
        key_secret_exists: !!RAZORPAY_KEY_SECRET,
        key_id_prefix: RAZORPAY_KEY_ID ? RAZORPAY_KEY_ID.substring(0, 8) + '...' : 'not set',
        orders_in_store: ordersStore.size,
        server_time: new Date().toISOString()
    });
});

// --- 4. ERROR HANDLING ---
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        message: `Route not found: ${req.method} ${req.path}` 
    });
});

app.use((err, req, res, next) => {
    console.error('❌ Unhandled Error:', err.stack);
    res.status(500).json({ 
        success: false, 
        message: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { error: err.message })
    });
});

// --- 5. START SERVER ---
app.listen(PORT, () => {
    console.log(`
🚀 Server is live!
📍 Port: ${PORT}
📍 URL: https://soraserver.onrender.com
📍 Razorpay: ${RAZORPAY_KEY_ID ? 'Configured ✅' : 'Not Configured ❌'}
📍 Key Secret: ${RAZORPAY_KEY_SECRET ? 'Set ✅' : 'Missing ❌'}
    `);
});
