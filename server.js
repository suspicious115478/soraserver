require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ IMPROVED CORS Configuration
app.use(cors({
    origin: [
        'https://conspicuous-solutions.in',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        '*'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true
}));

// ✅ Handle preflight requests
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ✅ Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Enhanced Debug environment variables
console.log('🚀 === Server Starting ===');
console.log('📍 PORT:', PORT);
console.log('📍 NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('📍 RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID ? `✓ Loaded (${process.env.RAZORPAY_KEY_ID.substring(0, 10)}...)` : '✗ Missing');
console.log('📍 RAZORPAY_KEY_SECRET:', process.env.RAZORPAY_KEY_SECRET ? '✓ Loaded' : '✗ Missing');

// ✅ Initialize Razorpay with better error handling
let razorpay;
let razorpayEnabled = false;

if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    try {
        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
        razorpayEnabled = true;
        console.log('✅ Razorpay initialized successfully');
    } catch (error) {
        console.error('❌ Razorpay initialization failed:', error.message);
        razorpayEnabled = false;
    }
} else {
    console.log('⚠️ Razorpay keys missing - payment features will not work');
}

// ✅ Store to keep track of orders
const ordersStore = new Map();

// ✅ Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, req.body || '');
    next();
});

// ✅ 1. Enhanced Health Check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Server is running!',
        timestamp: new Date().toISOString(),
        port: PORT,
        razorpay: razorpayEnabled ? 'Enabled' : 'Disabled',
        environment: process.env.NODE_ENV || 'development'
    });
});

// ✅ 2. Enhanced Test Endpoint
app.get('/api/test', (req, res) => {
    res.json({ 
        success: true,
        message: 'API is working!',
        timestamp: new Date().toISOString(),
        razorpay: razorpayEnabled ? 'Configured' : 'Not configured',
        endpoints: {
            createOrder: 'POST /api/create-order',
            verifyPayment: 'POST /api/verify-payment',
            debug: 'GET /api/debug/razorpay'
        }
    });
});

// ✅ 3. Root endpoint
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'ScreenRent Backend API',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        status: 'Operational',
        razorpay: razorpayEnabled ? 'Active' : 'Inactive',
        endpoints: {
            health: 'GET /health',
            test: 'GET /api/test',
            createOrder: 'POST /api/create-order',
            verifyPayment: 'POST /api/verify-payment',
            debug: 'GET /api/debug/razorpay'
        }
    });
});

// ✅ 4. Debug Razorpay Configuration
app.get('/api/debug/razorpay', (req, res) => {
    const debugInfo = {
        razorpayEnabled: razorpayEnabled,
        keyId: process.env.RAZORPAY_KEY_ID ? '✓ Set' : '✗ Missing',
        keySecret: process.env.RAZORPAY_KEY_SECRET ? '✓ Set' : '✗ Missing',
        keyIdPreview: process.env.RAZORPAY_KEY_ID ? 
            process.env.RAZORPAY_KEY_ID.substring(0, 10) + '...' : 'Not available',
        environment: process.env.NODE_ENV || 'development',
        serverTime: new Date().toISOString(),
        ordersInMemory: ordersStore.size
    };
    
    res.json({
        success: true,
        debug: debugInfo,
        message: razorpayEnabled ? 'Razorpay is properly configured' : 'Razorpay configuration issues'
    });
});

// ✅ 5. Test Razorpay Connection
app.get('/api/test-razorpay', async (req, res) => {
    try {
        if (!razorpayEnabled || !razorpay) {
            return res.status(503).json({
                success: false,
                message: 'Razorpay not configured properly'
            });
        }
        
        // Test Razorpay connection by creating a small test order
        const testOrder = await razorpay.orders.create({
            amount: 100, // 1 rupee
            currency: 'INR',
            receipt: `test_${Date.now()}`,
            payment_capture: 1
        });
        
        res.json({
            success: true,
            message: '✅ Razorpay connection successful!',
            orderId: testOrder.id,
            test: 'API keys are valid and working'
        });
        
    } catch (error) {
        console.error('❌ Razorpay test failed:', error);
        res.status(500).json({
            success: false,
            message: '❌ Razorpay test failed',
            error: error.error?.description || error.message,
            debug: {
                keyId: process.env.RAZORPAY_KEY_ID ? 'Present' : 'Missing',
                keySecret: process.env.RAZORPAY_KEY_SECRET ? 'Present' : 'Missing'
            }
        });
    }
});

// ✅ 6. CREATE ORDER ENDPOINT - FIXED AMOUNT HANDLING
app.post('/api/create-order', async (req, res) => {
    try {
        console.log('📦 Create order request received:', req.body);
        
        // Check if Razorpay is configured
        if (!razorpayEnabled || !razorpay) {
            return res.status(503).json({
                success: false,
                message: 'Payment service is currently unavailable. Please try again later.'
            });
        }

        const { amount, currency = 'INR', receipt } = req.body;
        
        // ✅ VALIDATION: Check if amount is provided and valid
        if (!amount || isNaN(amount)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid amount provided'
            });
        }
        
        // Convert to integer and validate
        const amountInPaise = parseInt(amount);
        
        console.log('💰 Amount details:', {
            received: amount,
            parsed: amountInPaise,
            type: typeof amount,
            inRupees: (amountInPaise / 100).toFixed(2)
        });
        
        // ✅ VALIDATION: Minimum amount check (100 paise = ₹1)
        if (amountInPaise < 100) {
            return res.status(400).json({
                success: false,
                message: `Amount too small. Minimum amount is ₹1 (100 paise). Received: ${amountInPaise} paise`
            });
        }
        
        // ✅ VALIDATION: Maximum amount check (₹1,00,000)
        if (amountInPaise > 10000000) {
            return res.status(400).json({
                success: false,
                message: 'Amount too large. Maximum amount is ₹1,00,000'
            });
        }
        
        const orderOptions = {
            amount: amountInPaise, // ✅ Use as is - already in paise from frontend
            currency: currency,
            receipt: receipt || `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            payment_capture: 1,
            notes: {
                description: 'Screen Rental Booking',
                platform: 'ScreenRent'
            }
        };

        console.log('🎯 Creating Razorpay order with:', orderOptions);
        
        const order = await razorpay.orders.create(orderOptions);
        
        console.log('✅ Order created successfully:', {
            id: order.id,
            amount: order.amount,
            currency: order.currency,
            status: order.status
        });
        
        // Store order details for verification
        ordersStore.set(order.id, {
            amount: order.amount,
            currency: order.currency,
            receipt: order.receipt,
            created_at: new Date(),
            status: 'created',
            original_amount: amountInPaise
        });
        
        res.json({
            success: true,
            message: 'Order created successfully',
            order: {
                id: order.id,
                amount: order.amount,
                currency: order.currency,
                receipt: order.receipt,
                status: order.status
            }
        });
        
    } catch (error) {
        console.error('❌ Error creating order:', error);
        
        // Enhanced error response
        const errorResponse = {
            success: false,
            message: 'Failed to create payment order',
            error: error.error?.description || error.message,
            code: error.statusCode || 500
        };
        
        // Add debug info in development
        if (process.env.NODE_ENV !== 'production') {
            errorResponse.debug = {
                razorpayEnabled,
                hasKeys: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
                requestBody: req.body
            };
        }
        
        res.status(error.statusCode || 500).json(errorResponse);
    }
});

// ✅ 7. VERIFY PAYMENT ENDPOINT - ENHANCED
app.post('/api/verify-payment', (req, res) => {
    try {
        console.log('🔍 Verify payment request:', req.body);
        
        const { order_id, payment_id, signature } = req.body;
        
        if (!order_id || !payment_id || !signature) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters: order_id, payment_id, signature'
            });
        }
        
        // Check if order exists in our store
        if (!ordersStore.has(order_id)) {
            return res.status(404).json({
                success: false,
                message: 'Order not found. It may have expired or was not created by this server.'
            });
        }
        
        // Generate expected signature
        const generated_signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(order_id + "|" + payment_id)
            .digest('hex');
        
        console.log('🔐 Signature verification:', {
            received: signature,
            generated: generated_signature,
            match: generated_signature === signature
        });
        
        if (generated_signature === signature) {
            // Update order status
            const order = ordersStore.get(order_id);
            order.status = 'verified';
            order.payment_id = payment_id;
            order.verified_at = new Date();
            order.signature_match = true;
            
            console.log('✅ Payment verified successfully:', payment_id);
            
            res.json({
                success: true,
                message: 'Payment verified successfully',
                orderId: order_id,
                paymentId: payment_id,
                verifiedAt: new Date().toISOString()
            });
        } else {
            console.log('❌ Signature mismatch for order:', order_id);
            
            // Update order status to failed verification
            const order = ordersStore.get(order_id);
            order.status = 'verification_failed';
            order.verification_attempts = (order.verification_attempts || 0) + 1;
            
            res.status(400).json({
                success: false,
                message: 'Payment verification failed - signature mismatch',
                orderId: order_id
            });
        }
    } catch (error) {
        console.error('❌ Error verifying payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error verifying payment',
            error: error.message
        });
    }
});

// ✅ 8. GET ORDER DETAILS ENDPOINT
app.get('/api/orders/:orderId', (req, res) => {
    try {
        const { orderId } = req.params;
        
        if (!ordersStore.has(orderId)) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        const order = ordersStore.get(orderId);
        res.json({
            success: true,
            order: {
                id: orderId,
                ...order
            }
        });
        
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching order details'
        });
    }
});

// ✅ 9. GET ALL ORDERS ENDPOINT (for debugging)
app.get('/api/orders', (req, res) => {
    const ordersArray = Array.from(ordersStore.entries()).map(([id, details]) => {
        return { 
            id, 
            ...details,
            // Don't expose sensitive information
            original_amount: undefined
        };
    });
    
    res.json({
        success: true,
        orders: ordersArray,
        count: ordersArray.length,
        totalAmount: ordersArray.reduce((sum, order) => sum + order.amount, 0)
    });
});

// ✅ 10. CLEAR ORDERS ENDPOINT (for testing)
app.delete('/api/orders', (req, res) => {
    const count = ordersStore.size;
    ordersStore.clear();
    
    res.json({
        success: true,
        message: `Cleared ${count} orders from memory`,
        cleared: count
    });
});

// ✅ 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.path,
        availableEndpoints: [
            'GET /health',
            'GET /api/test', 
            'POST /api/create-order',
            'POST /api/verify-payment',
            'GET /api/debug/razorpay'
        ]
    });
});

// ✅ Error handling middleware
app.use((error, req, res, next) => {
    console.error('💥 Server error:', error);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        ...(process.env.NODE_ENV !== 'production' && { error: error.message })
    });
});

// ✅ Server startup with enhanced logging
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎉 Server started successfully on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📍 Razorpay: ${razorpayEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`📍 Health check: https://soraserver.onrender.com/health`);
    console.log(`📍 API test: https://soraserver.onrender.com/api/test`);
    console.log(`📍 Razorpay debug: https://soraserver.onrender.com/api/debug/razorpay`);
    console.log('📍 Waiting for requests...\n');
}).on('error', (err) => {
    console.error('❌ Server failed to start:', err);
    process.exit(1);
});

// ✅ Handle process events
process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

// ✅ Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully');
    process.exit(0);
});
