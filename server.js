require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. MIDDLEWARES ---

// ✅ CORS Configuration: Isse routes se pehle hona chahiye
app.use(cors({
    origin: '*', // Production mein isse apni domain se replace karein
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.options('*', cors());

// ✅ Body Parser: Isse routes se pehle hona chahiye taaki req.body read ho sake
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Request Logger: Har request ka console log
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    if (req.method === 'POST') console.log('Payload:', req.body);
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

// Health Check
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
            amount: Math.round(amount * 100), // Paise mein convert
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

// ✅ UPDATED: Verify Payment
app.post('/api/verify-payment', (req, res) => {
    try {
        const { order_id, payment_id, signature } = req.body;

        // Debugging logs
        console.log("Verifying Payment for Order:", order_id);

        if (!order_id || !payment_id || !signature) {
            console.error("❌ Verification failed: Missing parameters");
            return res.status(400).json({ 
                success: false, 
                message: 'order_id, payment_id, and signature are required' 
            });
        }

        if (!RAZORPAY_KEY_SECRET) {
            console.error("❌ RAZORPAY_KEY_SECRET is not defined!");
            return res.status(500).json({ success: false, message: 'Server secret missing' });
        }

        // Signature Validation Logic
        const body = order_id + "|" + payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature === signature) {
            console.log("✅ Signature matched!");
            
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
            console.error("❌ Signature mismatch!");
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

// View Orders (Debug Only)
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
