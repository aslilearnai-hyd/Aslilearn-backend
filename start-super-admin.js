#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Super Admin Backend Server...');
console.log('📊 Super Admin Dashboard API Endpoints:');
console.log('   🔐 Login: POST /api/super-admin/login');
console.log('   📈 Stats: GET /api/super-admin/stats');
console.log('   👥 Admins: GET /api/super-admin/admins');
console.log('   👤 Users: GET /api/super-admin/users');
console.log('   📚 Courses: GET /api/super-admin/courses');
console.log('   📊 Analytics: GET /api/super-admin/analytics');
console.log('   💳 Subscriptions: GET /api/super-admin/subscriptions');
console.log('   📤 Export: GET /api/super-admin/export');
console.log('');
console.log('🔑 Super Admin Credentials:');
console.log('   Email: amenityforge@gmail.com');
console.log('   Password: Amenity');
console.log('');

// Start the backend server
const backend = spawn('node', ['index.js'], {
  cwd: path.join(__dirname),
  stdio: 'inherit',
  shell: true
});

backend.on('error', (err) => {
  console.error('❌ Failed to start backend server:', err);
  process.exit(1);
});

backend.on('close', (code) => {
  console.log(`Backend server exited with code ${code}`);
  process.exit(code);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down backend server...');
  backend.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down backend server...');
  backend.kill('SIGTERM');
  process.exit(0);
});

// Show startup message
setTimeout(() => {
  console.log('✅ Super Admin Backend is running!');
  console.log('🌐 API Base URL: http://localhost:3001');
  console.log('🔗 Frontend should connect to: http://localhost:3001');
  console.log('');
  console.log('📱 To test Super Admin Dashboard:');
  console.log('   1. Start your frontend: cd ../client && npm run dev');
  console.log('   2. Go to: http://localhost:5173');
  console.log('   3. Click "Super Admin Access" button');
    console.log('   4. Login with: amenityforge@gmail.com / Amenity');
}, 2000);








