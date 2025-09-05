require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Debug: Check if environment variables are loaded
console.log('Environment loaded:');
console.log('RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID ? '✓ Loaded' : '✗ Missing');
console.log('RAZORPAY_KEY_SECRET:', process.env.RAZORPAY_KEY_SECRET ? '✓ Loaded' : '✗ Missing');
console.log('PORT:', PORT);
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');

// Middleware with enhanced CORS
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, server-side requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://shiny-marzipan-e2ad1e.netlify.app', // Your frontend URL (removed trailing slash)
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];
    
    // Allow all origins in development
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
      console.log('CORS error:', msg);
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));
app.use(express.json());

// Serve static files if needed
app.use(express.static(path.join(__dirname, 'public')));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (Object.keys(req.body).length > 0 && req.path !== '/api/verify-payment') {
    // Don't log full payment verification requests for security
    console.log('Request body:', JSON.stringify(req.body).substring(0, 200) + '...');
  }
  next();
});

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Test Razorpay connection on startup
razorpay.orders.all({count: 1})
  .then(() => console.log('✓ Razorpay connection successful'))
  .catch(error => {
    console.error('✗ Razorpay connection failed:', error.error?.description || error.message);
    if (error.error && error.error.description) {
      console.error('Razorpay error details:', error.error);
    }
  });

// Store to keep track of orders
const ordersStore = new Map();

// 1. Create Order Endpoint
app.post('/api/create-order', async (req, res) => {
  try {
    console.log('=== CREATE ORDER REQUEST ===');
    const { amount, currency, receipt } = req.body;
    
    // Validate amount
    if (!amount || amount < 1) {
      console.log('Invalid amount:', amount);
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }
    
    // Generate a shorter receipt ID if needed
    const shortReceipt = receipt && receipt.length > 40 
      ? `rec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
      : receipt || `rec_${Date.now()}`;
    
    const options = {
      amount: Math.round(amount * 100), // amount in paise
      currency: currency || 'INR',
      receipt: shortReceipt,
      payment_capture: 1 // auto capture payment
    };

    console.log('Creating order with options:', options);
    
    const order = await razorpay.orders.create(options);
    console.log('Order created successfully:', order.id);
    
    // Store order details temporarily
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
    console.error('❌ Error creating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.error ? error.error.description : error.message
    });
  }
});

// 2. Verify Payment Endpoint
app.post('/api/verify-payment', (req, res) => {
  try {
    console.log('=== VERIFY PAYMENT REQUEST ===');
    
    const { order_id, payment_id, signature } = req.body;
    
    if (!order_id || !payment_id || !signature) {
      console.log('Missing parameters for verification');
      return res.status(400).json({
        success: false,
        message: 'Missing parameters for verification'
      });
    }
    
    // Generate expected signature
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(order_id + "|" + payment_id)
      .digest('hex');
    
    console.log('Generated signature:', generated_signature);
    console.log('Received signature:', signature);
    console.log('Signatures match:', generated_signature === signature);
    
    if (generated_signature === signature) {
      // Update order status
      if (ordersStore.has(order_id)) {
        const order = ordersStore.get(order_id);
        order.status = 'verified';
        order.payment_id = payment_id;
        order.verified_at = new Date();
        ordersStore.set(order_id, order);
      }
      
      console.log('✅ Payment verified successfully for order:', order_id);
      res.json({
        success: true,
        message: 'Payment verified successfully',
        orderId: order_id,
        paymentId: payment_id
      });
    } else {
      console.log('❌ Payment verification failed for order:', order_id);
      res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }
  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying payment'
    });
  }
});

// 3. Get all orders endpoint (for debugging)
app.get('/api/orders', (req, res) => {
  const ordersArray = Array.from(ordersStore.entries()).map(([id, details]) => {
    return { id, ...details };
  });
  
  console.log('Returning orders:', ordersArray.length);
  res.json({
    success: true,
    orders: ordersArray,
    count: ordersArray.length
  });
});

// 4. Get specific order endpoint
app.get('/api/orders/:orderId', (req, res) => {
  const orderId = req.params.orderId;
  const order = ordersStore.get(orderId);
  
  if (order) {
    res.json({
      success: true,
      order: { id: orderId, ...order }
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }
});

// 5. Health Check Endpoint with more info
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    ordersCount: ordersStore.size,
    razorpayConfigured: !!process.env.RAZORPAY_KEY_ID,
    environment: process.env.NODE_ENV || 'development'
  });
});

// 6. Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is working!',
    timestamp: new Date().toISOString(),
    razorpayKey: process.env.RAZORPAY_KEY_ID ? 'Configured' : 'Missing',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'ScreenRent Backend API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      test: '/api/test',
      createOrder: '/api/create-order (POST)',
      verifyPayment: '/api/verify-payment (POST)',
      getOrders: '/api/orders (GET)'
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  console.log('404 - Route not found:', req.method, req.path);
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=== Server started on port ${PORT} ===`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Test endpoint: http://localhost:${PORT}/api/test`);
  console.log(`Orders debug: http://localhost:${PORT}/api/orders`);
  console.log('Waiting for requests...\n');
});
