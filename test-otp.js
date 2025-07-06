const axios = require('axios');

// Test pengiriman OTP
async function testOTP() {
    try {
        console.log('Testing OTP functionality...');
        
        // Test dengan nomor yang valid (sesuai dengan data di GenieACS)
        const testPhone = '6281947215703'; // Ganti dengan nomor yang ada di sistem
        
        // Gunakan URLSearchParams untuk format yang benar
        const params = new URLSearchParams();
        params.append('phone', testPhone);
        
        const response = await axios.post('http://localhost:4555/customer/login', params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        console.log('Response status:', response.status);
        console.log('Response data length:', response.data.length);
        
        if (response.data.includes('otp')) {
            console.log('✅ OTP page rendered successfully');
        } else {
            console.log('❌ OTP page not found in response');
            console.log('Response contains:', response.data.substring(0, 200) + '...');
        }
        
    } catch (error) {
        console.error('Error testing OTP:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
    }
}

testOTP(); 