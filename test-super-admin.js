#!/usr/bin/env node

const API_BASE = 'http://localhost:3001';

// Test data
const testCredentials = {
  email: 'amenityforge@gmail.com',
  password: 'Amenity'
};

const testAdmin = {
  name: 'Test Admin',
  email: 'test.admin@example.com',
  permissions: ['User Management', 'Content Management']
};

const testUser = {
  name: 'Test User',
  email: 'test.user@example.com',
  role: 'student',
  details: 'Class 10 CBSE'
};

const testCourse = {
  title: 'Test Mathematics Course',
  subject: 'Mathematics',
  grade: 'Class 10',
  board: 'CBSE',
  teacher: 'Test Teacher'
};

// Helper function to make API calls
async function apiCall(endpoint, method = 'GET', data = null) {
  const url = `${API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  if (data) {
    options.body = JSON.stringify(data);
  }
  
  try {
    const response = await fetch(url, options);
    const result = await response.json();
    return { success: response.ok, data: result, status: response.status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Test functions
async function testSuperAdminLogin() {
  console.log('🔐 Testing Super Admin Login...');
  const result = await apiCall('/api/super-admin/login', 'POST', testCredentials);
  
  if (result.success) {
    console.log('✅ Super Admin Login: SUCCESS');
    console.log(`   Token: ${result.data.token ? 'Generated' : 'Missing'}`);
    console.log(`   User: ${result.data.user?.fullName || 'Unknown'}`);
    return result.data.token;
  } else {
    console.log('❌ Super Admin Login: FAILED');
    console.log(`   Error: ${result.data?.message || result.error}`);
    return null;
  }
}

async function testStats() {
  console.log('📊 Testing Dashboard Stats...');
  const result = await apiCall('/api/super-admin/stats');
  
  if (result.success) {
    console.log('✅ Dashboard Stats: SUCCESS');
    console.log(`   Total Users: ${result.data.totalUsers}`);
    console.log(`   Revenue: ₹${result.data.revenue}`);
    console.log(`   Courses: ${result.data.courses}`);
    console.log(`   Teachers: ${result.data.teachers}`);
    console.log(`   Admins: ${result.data.admins}`);
  } else {
    console.log('❌ Dashboard Stats: FAILED');
    console.log(`   Error: ${result.data?.message || result.error}`);
  }
}

async function testAdmins() {
  console.log('👥 Testing Admin Management...');
  
  // Get existing admins
  const getResult = await apiCall('/api/super-admin/admins');
  if (getResult.success) {
    console.log('✅ Get Admins: SUCCESS');
    console.log(`   Found ${getResult.data.length} admins`);
  } else {
    console.log('❌ Get Admins: FAILED');
  }
  
  // Create new admin
  const createResult = await apiCall('/api/super-admin/admins', 'POST', testAdmin);
  if (createResult.success) {
    console.log('✅ Create Admin: SUCCESS');
    console.log(`   Admin ID: ${createResult.data.admin?.id || 'Unknown'}`);
  } else {
    console.log('❌ Create Admin: FAILED');
    console.log(`   Error: ${createResult.data?.message || createResult.error}`);
  }
}

async function testUsers() {
  console.log('👤 Testing User Management...');
  
  // Get existing users
  const getResult = await apiCall('/api/super-admin/users');
  if (getResult.success) {
    console.log('✅ Get Users: SUCCESS');
    console.log(`   Found ${getResult.data.length} users`);
  } else {
    console.log('❌ Get Users: FAILED');
  }
  
  // Create new user
  const createResult = await apiCall('/api/super-admin/users', 'POST', testUser);
  if (createResult.success) {
    console.log('✅ Create User: SUCCESS');
    console.log(`   User ID: ${createResult.data.user?.id || 'Unknown'}`);
  } else {
    console.log('❌ Create User: FAILED');
    console.log(`   Error: ${createResult.data?.message || createResult.error}`);
  }
}

async function testCourses() {
  console.log('📚 Testing Course Management...');
  
  // Get existing courses
  const getResult = await apiCall('/api/super-admin/courses');
  if (getResult.success) {
    console.log('✅ Get Courses: SUCCESS');
    console.log(`   Found ${getResult.data.length} courses`);
  } else {
    console.log('❌ Get Courses: FAILED');
  }
  
  // Create new course
  const createResult = await apiCall('/api/super-admin/courses', 'POST', testCourse);
  if (createResult.success) {
    console.log('✅ Create Course: SUCCESS');
    console.log(`   Course ID: ${createResult.data.course?.id || 'Unknown'}`);
  } else {
    console.log('❌ Create Course: FAILED');
    console.log(`   Error: ${createResult.data?.message || createResult.error}`);
  }
}

async function testAnalytics() {
  console.log('📈 Testing Analytics...');
  const result = await apiCall('/api/super-admin/analytics');
  
  if (result.success) {
    console.log('✅ Analytics: SUCCESS');
    console.log(`   Daily Active: ${result.data.dailyActive}`);
    console.log(`   Weekly Active: ${result.data.weeklyActive}`);
    console.log(`   Monthly Active: ${result.data.monthlyActive}`);
    console.log(`   Completion Rate: ${result.data.completionRate}%`);
  } else {
    console.log('❌ Analytics: FAILED');
    console.log(`   Error: ${result.data?.message || result.error}`);
  }
}

async function testSubscriptions() {
  console.log('💳 Testing Subscriptions...');
  const result = await apiCall('/api/super-admin/subscriptions');
  
  if (result.success) {
    console.log('✅ Subscriptions: SUCCESS');
    console.log(`   Found ${result.data.length} subscriptions`);
  } else {
    console.log('❌ Subscriptions: FAILED');
    console.log(`   Error: ${result.data?.message || result.error}`);
  }
}

async function testExport() {
  console.log('📤 Testing Data Export...');
  const result = await apiCall('/api/super-admin/export');
  
  if (result.success) {
    console.log('✅ Data Export: SUCCESS');
    console.log(`   Users: ${result.data.users?.length || 0}`);
    console.log(`   Videos: ${result.data.videos?.length || 0}`);
    console.log(`   Teachers: ${result.data.teachers?.length || 0}`);
    console.log(`   Export Date: ${result.data.exportDate}`);
  } else {
    console.log('❌ Data Export: FAILED');
    console.log(`   Error: ${result.data?.message || result.error}`);
  }
}

// Main test function
async function runTests() {
  console.log('🧪 Super Admin Backend API Tests');
  console.log('================================');
  console.log(`🌐 Testing against: ${API_BASE}`);
  console.log('');
  
  // Test login first
  const token = await testSuperAdminLogin();
  console.log('');
  
  if (!token) {
    console.log('❌ Cannot proceed without authentication token');
    return;
  }
  
  // Run all tests
  await testStats();
  console.log('');
  
  await testAdmins();
  console.log('');
  
  await testUsers();
  console.log('');
  
  await testCourses();
  console.log('');
  
  await testAnalytics();
  console.log('');
  
  await testSubscriptions();
  console.log('');
  
  await testExport();
  console.log('');
  
  console.log('🎉 Super Admin Backend Tests Complete!');
  console.log('');
  console.log('📱 Next Steps:');
  console.log('   1. Start your frontend: cd ../client && npm run dev');
  console.log('   2. Go to: http://localhost:5173');
  console.log('   3. Click "Super Admin Access" button');
    console.log('   4. Login with: amenityforge@gmail.com / Amenity');
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
  console.log('❌ This test requires Node.js 18+ with fetch support');
  console.log('   Please upgrade Node.js or install node-fetch');
  process.exit(1);
}

// Run tests
runTests().catch(console.error);








