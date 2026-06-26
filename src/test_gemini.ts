import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || '';

async function testGemini() {
  console.log('Testing Gemini API key:', apiKey ? 'FOUND (starts with ' + apiKey.substring(0, 7) + '...)' : 'MISSING');
  if (!apiKey) return;

  const genAI = new GoogleGenerativeAI(apiKey);
  
  const modelsToTest = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

  for (const modelName of modelsToTest) {
    try {
      console.log(`\nAttempting generateContent using model: "${modelName}"...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('Say hello in exactly 3 words.');
      const text = result.response.text();
      console.log(`[SUCCESS] Model "${modelName}" replied: "${text.trim()}"`);
      return; // Stop if any model succeeds!
    } catch (err: any) {
      console.error(`[FAILED] Model "${modelName}" failed:`, err.message);
    }
  }
}

testGemini();
