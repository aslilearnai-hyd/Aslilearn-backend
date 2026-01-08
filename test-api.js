// Test script to check API endpoints
const fetch = require('node-fetch');

async function testEndpoints() {
  const baseUrl = 'http://localhost:3001';
  
  try {
    console.log('🧪 Testing Super Admin Login...');
    
    // First, login as super admin
    const loginResponse = await fetch(`${baseUrl}/api/super-admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'amenityforge@gmail.com',
        password: 'Amenity'
      })
    });
    
    if (!loginResponse.ok) {
      console.error('❌ Login failed:', loginResponse.status, loginResponse.statusText);
      return;
    }
    
    const loginData = await loginResponse.json();
    console.log('✅ Login successful');
    
    const token = loginData.token;
    
    // Test dashboard stats endpoint
    console.log('\n🧪 Testing Dashboard Stats...');
    const statsResponse = await fetch(`${baseUrl}/api/super-admin/dashboard/stats`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (statsResponse.ok) {
      const statsData = await statsResponse.json();
      console.log('✅ Dashboard Stats:', statsData);
    } else {
      console.error('❌ Dashboard Stats failed:', statsResponse.status, statsResponse.statusText);
      const errorText = await statsResponse.text();
      console.error('Error details:', errorText);
    }
    
    // Test admin analytics endpoint
    console.log('\n🧪 Testing Admin Analytics...');
    const adminsResponse = await fetch(`${baseUrl}/api/super-admin/admins`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (adminsResponse.ok) {
      const adminsData = await adminsResponse.json();
      console.log('✅ Admin Analytics:', adminsData);
    } else {
      console.error('❌ Admin Analytics failed:', adminsResponse.status, adminsResponse.statusText);
      const errorText = await adminsResponse.text();
      console.error('Error details:', errorText);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testEndpoints();






