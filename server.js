require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ PEHLE BASIC CORS - Simple aur working
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ✅ Preflight requests handle karo
app.options('*', cors());

app.use(express.json());

// ✅ Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Debug environment variables
console.log('=== Server Starting ===');
console.log('PORT:', PORT);
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID ? '✓ Loaded' : '✗ Missing');

// ✅ Basic health check - sabse pehle
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Server is running!',
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// ✅ Simple test endpoint
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'API is working!',
        timestamp: new Date().toISOString(),
        razorpay: process.env.RAZORPAY_KEY_ID ? 'Configured' : 'Not configured'
    });
});

// ✅ Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'ScreenRent Backend API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: '/health',
            test: '/api/test',
            createOrder: '/api/create-order (POST)',
            verifyPayment: '/api/verify-payment (POST)'
        }
    });
});

// ✅ Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ✅ Initialize Razorpay only if keys are available
let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    console.log('✓ Razorpay initialized');
} else {
    console.log('⚠️ Razorpay keys missing - payment features will not work');
}

// ✅ Store to keep track of orders
const ordersStore = new Map();

// ✅ 1. Create Order Endpoint
app.post('/api/create-order', async (req, res) => {
    try {
        // Check if Razorpay is configured
        if (!razorpay) {
            return res.status(500).json({
                success: false,
                message: 'Payment service not configured'
            });
        }

        console.log('Create order request:', req.body);
        const { amount, currency, receipt } = req.body;
        
        // Validate amount
        if (!amount || amount < 1) {
            return res.status(400).json({
                success: false,
                message: 'Invalid amount'
            });
        }
        
        const options = {
            amount: Math.round(amount * 100), // amount in paise
            currency: currency || 'INR',
            receipt: receipt || `rec_${Date.now()}`,
            payment_capture: 1
        };

        const order = await razorpay.orders.create(options);
        console.log('Order created:', order.id);
        
        // Store order details
        ordersStore.set(order.id, {
            amount: options.amount,
            currency: options.currency,
            receipt: options.receipt,
            created_at: new Date(),
            status: 'created'
        });
        
        res.json({
            success: true,
            order: order
        });
        
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create order',
            error: error.error ? error.error.description : error.message
        });
    }
});

// ✅ 2. Verify Payment Endpoint
app.post('/api/verify-payment', (req, res) => {
    try {
        console.log('Verify payment request:', req.body);
        
        const { order_id, payment_id, signature } = req.body;
        
        if (!order_id || !payment_id || !signature) {
            return res.status(400).json({
                success: false,
                message: 'Missing parameters'
            });
        }
        
        // Generate expected signature
        const generated_signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
            .update(order_id + "|" + payment_id)
            .digest('hex');
        
        if (generated_signature === signature) {
            // Update order status
            if (ordersStore.has(order_id)) {
                const order = ordersStore.get(order_id);
                order.status = 'verified';
                order.payment_id = payment_id;
                order.verified_at = new Date();
            }
            
            res.json({
                success: true,
                message: 'Payment verified successfully',
                orderId: order_id,
                paymentId: payment_id
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'Payment verification failed'
            });
        }
    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error verifying payment'
        });
    }
});

// ✅ 3. Get all orders endpoint (for debugging)
app.get('/api/orders', (req, res) => {
    const ordersArray = Array.from(ordersStore.entries()).map(([id, details]) => {
        return { id, ...details };
    });
    
    res.json({
        success: true,
        orders: ordersArray,
        count: ordersArray.length
    });
});

// ✅ 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.path
    });
});

// ✅ Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// ✅ Server startup with error handling
app.listen(PORT, () => {
    console.log(`\n🚀 Server started successfully on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📍 Health check: https://soraserver.onrender.com/health`);
    console.log(`📍 API test: https://soraserver.onrender.com/api/test`);
    console.log('📍 Waiting for requests...\n');
}).on('error', (err) => {
    console.error('❌ Server failed to start:', err);
    // process.exit(1);
});

// ✅ Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

