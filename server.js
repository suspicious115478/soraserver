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

// ✅ NEW: Bulletproof YouTube Converter using Invidious API (Since Piped is dead)
app.post('/api/convert-youtube', async (req, res) => {
    const { url } = req.body;
    
    if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
        return res.status(400).json({ success: false, message: 'Valid YouTube URL required' });
    }

    console.log('🔄 Converting YouTube URL via Invidious APIs:', url);
    
    try {
        // 1. Extract Video ID
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=))([^"&?\/\s]{11})/);
        const videoId = match ? match[1] : null;

        if (!videoId) {
            return res.status(400).json({ success: false, message: 'Could not extract Video ID' });
        }

        console.log(`🔄 Fetching stream data for ID: ${videoId}`);

        // 🌐 LIST OF INVIDIOUS API SERVERS (Active Alternatives to Piped)
        const INVIDIOUS_INSTANCES = [
            'https://vid.puffyan.us',
            'https://inv.tux.pizza',
            'https://invidious.protokolla.fi',
            'https://invidious.perennialte.ch',
            'https://yt.artemislena.eu'
        ];

        let finalMediaUrl = null;

        // 🔄 Loop through Invidious servers
        for (const instance of INVIDIOUS_INSTANCES) {
            try {
                console.log(`📡 Trying Invidious instance: ${instance}...`);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 sec timeout
                
                const response = await fetch(`${instance}/api/v1/videos/${videoId}`, {
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (response.ok) {
                    const data = await response.json();
                    
                    // Priority 1: HLS (m3u8) Stream if available
                    if (data.hlsUrl) {
                        finalMediaUrl = data.hlsUrl;
                        console.log(`✅ Success (HLS) with instance: ${instance}`);
                        break;
                    } 
                    // Priority 2: Direct MP4 Video URL (Universally Playable)
                    else if (data.formatStreams && data.formatStreams.length > 0) {
                        // Sort to get best quality (usually 720p with audio)
                        const bestStream = data.formatStreams.sort((a, b) => {
                            const resA = parseInt(a.resolution) || 0;
                            const resB = parseInt(b.resolution) || 0;
                            return resB - resA; // Descending
                        })[0];
                        
                        finalMediaUrl = bestStream.url;
                        console.log(`✅ Success (MP4 - ${bestStream.resolution}) with instance: ${instance}`);
                        break;
                    }
                } else {
                    console.log(`⚠️ Instance ${instance} returned status ${response.status}`);
                }
            } catch (err) {
                console.log(`⚠️ Instance ${instance} failed: ${err.message}`);
            }
        }

        // Final check
        if (finalMediaUrl) {
            // Hum key ka naam 'm3u8Url' hi rakh rahe hain taaki aapka frontend na tute
            res.json({ success: true, m3u8Url: finalMediaUrl }); 
        } else {
            throw new Error("All Invidious instances failed to extract the stream.");
        }

    } catch (error) {
        console.error(`❌ Complete conversion failure: ${error.message}`);
        res.status(500).json({ 
            success: false, 
            message: 'All video proxy servers are currently down. Please try again later.' 
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
