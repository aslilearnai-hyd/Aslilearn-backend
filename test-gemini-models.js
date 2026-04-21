// Test script to check which Gemini models are available
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Set GEMINI_API_KEY in ASLI-STUD-BACK/.env');
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(API_KEY);

const modelsToTest = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.0-flash-latest',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro-latest',
  'gemini-1.0-pro',
  'gemini-pro'
];

async function testModels() {
  console.log('🧪 Testing Gemini models...\n');
  
  for (const modelName of modelsToTest) {
    try {
      console.log(`🔄 Testing: ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('Say "Hello" in one word.');
      const response = await result.response;
      const text = response.text();
      console.log(`✅ ${modelName} - SUCCESS! Response: ${text.trim()}\n`);
    } catch (error) {
      console.log(`❌ ${modelName} - FAILED: ${error.message}\n`);
    }
  }
  
  console.log('✅ Testing complete!');
}

testModels().catch(console.error);

