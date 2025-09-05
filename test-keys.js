require('dotenv').config();
const Razorpay = require('razorpay');

console.log('Testing Razorpay keys...');
console.log('Key ID:', process.env.RAZORPAY_KEY_ID);
console.log('Key Secret:', process.env.RAZORPAY_KEY_SECRET ? 'Present' : 'Missing');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Test the connection
razorpay.orders.all({count: 1})
  .then(response => {
    console.log('✅ Keys are working correctly!');
  })
  .catch(error => {
    console.log('❌ Error with keys:', error.error.description);
    console.log('Please check your Razorpay keys in the .env file');
  });