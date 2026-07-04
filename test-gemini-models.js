// Test script to check which Gemini models are available
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();
const API_KEY = process.env.GEMINI_API_KEY || process.env.VIDYA_AI_GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Set GEMINI_API_KEY in backend/.env');
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(API_KEY);

const modelsToTest = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
];

async function testModels() {
  console.log('Testing Gemini models...\n');

  for (const modelName of modelsToTest) {
    try {
      console.log(`Testing: ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('Say "Hello" in one word.');
      const response = await result.response;
      const text = response.text();
      console.log(`OK ${modelName} - ${text.trim()}\n`);
    } catch (error) {
      console.log(`FAIL ${modelName} - ${error.message}\n`);
    }
  }

  console.log('Testing complete!');
}

testModels();
