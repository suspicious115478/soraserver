require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. MIDDLEWARES (ORDER MATTERS!) ---

// ✅ 1. Sabse pehle CORS taaki preflight requests (OPTIONS) handle ho sakein
app.use(cors({
    origin: '*', // Production mein isse apni frontend URL se replace karein
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

// ✅ 2. Pre-flight handling
app.options('*', cors());

// ✅ 3. Body Parsers (CORS ke BAAD rakhein)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ 4. Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    if (req.method === 'POST') {
        console.log('Payload Received:', JSON.stringify(req.body, null, 2));
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
    console.log('✅ Razorpay initialized successfully');
} else {
    console.error('❌ Razorpay keys missing in .env file!');
}

const ordersStore = new Map();

// --- 3. ROUTES ---

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Create Order
app.post('/api/create-order', async (req, res) => {
    try {
        if (!razorpay) throw new Error('Razorpay not configured');

        const { amount, currency, receipt } = req.body;
        
        if (!amount || amount < 1) {
            return res.status(400).json({ success: false, message: 'Invalid amount' });
        }

        const options = {
            amount: Math.round(amount * 100), 
            currency: currency || 'INR',
            receipt: receipt || `rec_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);
        
        ordersStore.set(order.id, {
            ...options,
            status: 'created',
            created_at: new Date()
        });

        res.json({ success: true, order });
    } catch (error) {
        console.error('Order Creation Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Verify Payment
app.post('/api/verify-payment', (req, res) => {
    try {
        // Frontend se jo keys aa rahi hain unhe destructure karein
        const { order_id, payment_id, signature } = req.body;

        console.log("Verifying Payment for Order:", order_id);

        if (!order_id || !payment_id || !signature) {
            console.error("❌ Verification failed: Missing parameters in body", req.body);
            return res.status(400).json({ 
                success: false, 
                message: 'order_id, payment_id, and signature are required' 
            });
        }

        if (!RAZORPAY_KEY_SECRET) {
            console.error("❌ RAZORPAY_KEY_SECRET is missing!");
            return res.status(500).json({ success: false, message: 'Server secret missing' });
        }

        // HMAC SHA256 Signature verification
        const generated_signature = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(order_id + "|" + payment_id)
            .digest('hex');

        if (generated_signature === signature) {
            console.log("✅ Signature matched for:", order_id);
            
            if (ordersStore.has(order_id)) {
                const orderData = ordersStore.get(order_id);
                orderData.status = 'verified';
                orderData.payment_id = payment_id;
            }

            return res.json({ 
                success: true, 
                message: 'Payment verified successfully' 
            });
        } else {
            console.error("❌ Signature mismatch! Possible tampering or wrong secret.");
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid signature. Payment verification failed.' 
            });
        }
    } catch (error) {
        console.error('Verification Error:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

app.get('/api/orders', (req, res) => {
    res.json({ success: true, orders: Array.from(ordersStore.values()) });
});

// --- 4. ERROR HANDLING ---

app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, message: 'Something went wrong!' });
});

// --- 5. START SERVER ---

app.listen(PORT, () => {
    console.log(`
🚀 Server is live!
📍 Port: ${PORT}
📍 URL: https://soraserver.onrender.com
    `);
});
