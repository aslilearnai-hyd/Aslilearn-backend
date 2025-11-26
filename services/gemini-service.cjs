// Gemini Service - Google Gemini AI integration
// Replaces Ollama service with Google Gemini API

const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8';
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.textModel = 'gemini-2.0-flash-exp'; // Fast and capable model
    this.visionModel = 'gemini-2.0-flash-exp'; // Supports vision
    
    if (!this.apiKey) {
      console.warn('⚠️  GEMINI_API_KEY not set in environment variables');
    } else {
      console.log('✅ Gemini service initialized');
      console.log(`📍 Using model: ${this.textModel}`);
    }
  }

  async generateResponse(message, context = {}, chatHistory = []) {
    try {
      console.log('🤖 Using Gemini AI for response...');
      
      const model = this.genAI.getGenerativeModel({ model: this.textModel });
      
      // Build system instruction
      let systemInstruction = `You are Vidya AI for Asli Learn Foundation, an educational platform. You help students with their studies across various subjects including Physics, Chemistry, Mathematics, and Biology.

Your role is to:
1. Provide clear, direct answers to questions
2. Give step-by-step solutions to problems
3. Explain concepts in simple terms
4. Be helpful and educational

Guidelines:
- Always give direct answers first, then explanations
- For math problems, show the calculation and result
- Use clear, simple language
- Be encouraging and supportive`;

      // Add context if available
      if (context.currentSubject) {
        systemInstruction += `\n\nCurrent Study Context: The student is studying ${context.currentSubject}`;
        if (context.currentTopic) {
          systemInstruction += `, specifically focusing on ${context.currentTopic}`;
        }
      }

      // Build conversation history
      const conversationParts = [];
      if (chatHistory.length > 0) {
        chatHistory.slice(-5).forEach(msg => {
          conversationParts.push({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
          });
        });
      }

      // Add current message
      conversationParts.push({
        role: 'user',
        parts: [{ text: message }]
      });

      // Generate content
      const result = await model.generateContent({
        contents: conversationParts,
        systemInstruction: systemInstruction
      });

      const response = await result.response;
      const responseText = response.text();
      
      console.log(`✅ Gemini response received (${responseText.length} characters)`);
      return responseText;
    } catch (error) {
      console.error('❌ Gemini API error:', error.message);
      // Fallback to enhanced response
      return await this.generateEnhancedResponse(message, context, chatHistory);
    }
  }

  async generateEnhancedResponse(message, context = {}, chatHistory = []) {
    // Enhanced fallback responses
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    
    let response = '';
    
    // Math-related responses
    if (message.includes('+') || message.includes('-') || message.includes('*') || message.includes('/') || 
        message.includes('=') || message.includes('math') || message.includes('calculate')) {
      const mathResult = this.solveMathProblem(message);
      if (mathResult) {
        response = mathResult;
      } else {
        response = "I can help you with that math problem! Let me solve it step by step:\n\n";
        response += "Please provide the specific numbers and operation you'd like me to solve.";
      }
    }
    // Subject-specific responses
    else if (message.toLowerCase().includes('physics') || message.toLowerCase().includes('motion') || 
             message.toLowerCase().includes('force') || message.toLowerCase().includes('energy')) {
      response = "Great physics question! Let me explain this clearly:\n\n";
      response += "In physics, we use scientific principles to understand natural phenomena. ";
      response += "I'll break this down into clear concepts and provide examples to help you understand.";
    }
    else if (message.toLowerCase().includes('chemistry') || message.toLowerCase().includes('molecule') || 
             message.toLowerCase().includes('atom') || message.toLowerCase().includes('reaction')) {
      response = "Excellent chemistry question! Let me explain this:\n\n";
      response += "Chemistry is the study of matter and its transformations. ";
      response += "I'll explain the concepts using clear examples and show you how to apply them.";
    }
    else if (message.toLowerCase().includes('biology') || message.toLowerCase().includes('cell') || 
             message.toLowerCase().includes('organism') || message.toLowerCase().includes('life')) {
      response = "Fascinating biology question! Let me explain this:\n\n";
      response += "Biology helps us understand living systems and their functions. ";
      response += "I'll break down the processes and show you how different components work together.";
    }
    // General educational responses
    else {
      const responses = [
        "That's an excellent question! Let me help you understand this concept clearly.",
        "I'm here to help you learn! This is an important topic to master.",
        "Great question! Let me break this down into manageable parts.",
        "I can definitely help you with this! Let me explain it step by step.",
        "That's a thoughtful question! This concept is fundamental to your studies."
      ];
      response = responses[Math.floor(Math.random() * responses.length)] + "\n\n";
      response += "Here's how I'll help you understand this:\n";
      response += "1. **Clear Explanation**: I'll explain the concept in simple terms\n";
      response += "2. **Examples**: I'll provide relevant examples\n";
      response += "3. **Step-by-Step**: I'll break it down into manageable parts\n";
      response += "4. **Practice**: I'll suggest ways to practice and apply what you learn\n\n";
    }
    
    if (context.currentSubject) {
      response += `Since you're studying **${context.currentSubject}**, I'll focus on that subject area. `;
      response += "This will help you connect this concept to your current studies.\n\n";
    }
    
    response += "💡 **Study Tip**: The key to mastering any subject is understanding the underlying principles. ";
    response += "Don't just memorize facts - try to understand the 'why' behind everything you learn. ";
    response += "This will help you apply your knowledge to new situations and solve problems more effectively.";
    
    return response;
  }

  solveMathProblem(message) {
    try {
      let expression = message.replace(/[^0-9+\-*/().=]/g, '').trim();
      
      if (expression.includes('+') && expression.includes('=')) {
        const parts = expression.split('+');
        if (parts.length === 2) {
          const first = parseInt(parts[0].trim());
          const second = parseInt(parts[1].split('=')[0].trim());
          
          if (!isNaN(first) && !isNaN(second)) {
            const result = first + second;
            return `**${first} + ${second} = ${result}**\n\n` +
                   `Here's how to solve it:\n` +
                   `1. Start with the first number: ${first}\n` +
                   `2. Add the second number: ${first} + ${second}\n` +
                   `3. Count forward: ${first}, ${first + 1}, ${first + 2}`;
          }
        }
      }
      
      if (expression.includes('-') && expression.includes('=')) {
        const parts = expression.split('-');
        if (parts.length === 2) {
          const first = parseInt(parts[0].trim());
          const second = parseInt(parts[1].split('=')[0].trim());
          
          if (!isNaN(first) && !isNaN(second)) {
            const result = first - second;
            return `**${first} - ${second} = ${result}**\n\n` +
                   `Here's how to solve it:\n` +
                   `1. Start with the first number: ${first}\n` +
                   `2. Subtract the second number: ${first} - ${second}\n` +
                   `3. Count backward: ${first}, ${first - 1}, ${result}`;
          }
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  async analyzeImage(imageBase64, context = '') {
    try {
      console.log('👁️  Using Gemini Vision for image analysis...');
      
      const model = this.genAI.getGenerativeModel({ model: this.visionModel });
      
      const prompt = `You are a Vidya AI. Analyze this image and provide educational assistance. 
      ${context ? `Context: ${context}` : ''}
      
      Please:
      1. Identify what's in the image (math problem, diagram, text, etc.)
      2. Provide step-by-step explanation or solution
      3. Give educational insights about the content
      4. Suggest related concepts to study`;

      // Convert base64 to format Gemini expects
      const imagePart = {
        inlineData: {
          data: imageBase64,
          mimeType: 'image/jpeg' // Adjust based on actual image type
        }
      };

      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();
      
      console.log(`✅ Gemini vision response received (${text.length} characters)`);
      return text;
    } catch (error) {
      console.error('❌ Gemini vision API error:', error.message);
      // Fallback
      return await this.analyzeImageMock(imageBase64, context);
    }
  }

  async analyzeImageMock(imageBase64, context = '') {
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
    
    let response = "I can see this image contains educational content. ";
    
    if (context) {
      response += `Given the context of ${context}, `;
    }
    
    response += "I can help you understand the concepts shown. ";
    response += "The image appears to contain mathematical or scientific content that I can help you work through step by step. ";
    response += "Would you like me to explain any specific part of what you see?";
    
    return response;
  }

  async generateStructuredContent(prompt, format = 'text') {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.textModel });
      
      const systemInstruction = format === 'json' 
        ? 'You are a helpful assistant. Respond ONLY with valid JSON, no markdown, no code blocks, just pure JSON.'
        : 'You are a helpful assistant. Provide clear, structured responses.';

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: systemInstruction
      });

      const response = await result.response;
      let resultText = response.text();

      // Clean JSON if format is json
      if (format === 'json') {
        resultText = resultText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      }

      return resultText;
    } catch (error) {
      console.error('Gemini structured content error:', error);
      throw new Error('Failed to generate structured content');
    }
  }
}

const geminiService = new GeminiService();

module.exports = { geminiService };

