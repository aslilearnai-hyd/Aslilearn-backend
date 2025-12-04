// Gemini Service - Google Gemini AI integration
// Replaces Ollama service with Google Gemini API

const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || 'AIzaSyCubFWwtDGDpj9jYmjzvng2QA_QYq9n4O0';
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.textModel = 'gemini-2.5-flash';
    this.visionModel = 'gemini-2.5-flash';
    
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
      
      const studentName = context?.studentName || 'Student';

      // Build system instruction
      let systemInstruction = `You are Vidya AI for AsliLearn, an educational platform. You help students with their studies across various subjects including Physics, Chemistry, Mathematics, and Biology.

Your role is to:
1. Provide clear, direct answers to questions
2. Give step-by-step solutions to problems
3. Explain concepts in simple terms
4. Be helpful and educational

Guidelines:
- Always give direct answers first, then explanations
- For math problems, show the calculation and result
- Use clear, simple language
- Be encouraging and supportive
- Always mention the student's name (${studentName}) in your greeting or first sentence
- Start with a warm acknowledgement like "Great question, ${studentName}!" or "Hi ${studentName}! Let's explore this."
- Keep the tone similar to friendly AI study assistants (Gemini, ChatGPT)`;

      // Add context if available
      if (context.currentSubject) {
        systemInstruction += `\n\nCurrent Study Context: The student is studying ${context.currentSubject}`;
        if (context.currentTopic) {
          systemInstruction += `, specifically focusing on ${context.currentTopic}`;
        }
      }

      // Build conversation history
      const conversationParts = [];
      let isFirstUserMessage = true;
      
      if (chatHistory.length > 0) {
        chatHistory.slice(-5).forEach(msg => {
          if (msg.role === 'user' && isFirstUserMessage) {
            // Include system instruction in the first user message
            conversationParts.push({
              role: 'user',
              parts: [{ text: `${systemInstruction}\n\n${msg.content}` }]
            });
            isFirstUserMessage = false;
          } else {
            conversationParts.push({
              role: msg.role === 'user' ? 'user' : 'model',
              parts: [{ text: msg.content }]
            });
          }
        });
      }

      // Add current message with system instruction if it's the first message
      if (isFirstUserMessage) {
        conversationParts.push({
          role: 'user',
          parts: [{ text: `${systemInstruction}\n\n${message}` }]
        });
      } else {
        conversationParts.push({
          role: 'user',
          parts: [{ text: message }]
        });
      }
      
      // Generate content
      const result = await model.generateContent(conversationParts);

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
    
    const studentName = context?.studentName || 'Student';
    const friendlyIntro = this.buildFriendlyIntro(message, studentName);

    // Math-related responses
    if (message.includes('+') || message.includes('-') || message.includes('*') || message.includes('/') || 
        message.includes('=') || message.includes('math') || message.includes('calculate')) {
      const mathResult = this.solveMathProblem(message);
      if (mathResult) {
        response = `${friendlyIntro}\n\n${mathResult}`;
      } else {
        response = `${friendlyIntro}\n\nPlease provide the specific numbers and operation you'd like me to solve, and I'll walk you through it step by step.`;
      }
    }
    // Subject-specific responses
    else if (message.toLowerCase().includes('physics') || message.toLowerCase().includes('motion') || 
             message.toLowerCase().includes('force') || message.toLowerCase().includes('energy')) {
      response = `${friendlyIntro}\n\nLet me explain this physics concept clearly:\n\n`;
      response += "In physics, we use scientific principles to understand natural phenomena. ";
      response += "I'll break this down into clear concepts and provide examples to help you understand.";
    }
    else if (message.toLowerCase().includes('chemistry') || message.toLowerCase().includes('molecule') || 
             message.toLowerCase().includes('atom') || message.toLowerCase().includes('reaction')) {
      response = `${friendlyIntro}\n\nExcellent chemistry question! Here's the breakdown:\n\n`;
      response += "Chemistry is the study of matter and its transformations. ";
      response += "I'll explain the concepts using clear examples and show you how to apply them.";
    }
    else if (message.toLowerCase().includes('biology') || message.toLowerCase().includes('cell') || 
             message.toLowerCase().includes('organism') || message.toLowerCase().includes('life')) {
      response = `${friendlyIntro}\n\nFascinating biology question! Here's how it works:\n\n`;
      response += "Biology helps us understand living systems and their functions. ";
      response += "I'll break down the processes and show you how different components work together.";
    }
    // General educational responses
    else {
      const responses = [
        `${friendlyIntro} This concept is fundamental to your studies.`,
        `${friendlyIntro} I'm excited to walk you through it.`,
        `${friendlyIntro} Let's break it down together.`,
        `${friendlyIntro} I'll guide you step by step.`
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
      const cleaned = message
        .replace(/[^0-9+\-*/.=]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const equationMatch = cleaned.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)(?:\s*=\s*(-?\d+(?:\.\d+)?))?/);
      if (!equationMatch) {
        return null;
      }

      const [, firstStr, operator, secondStr] = equationMatch;
      const first = parseFloat(firstStr);
      const second = parseFloat(secondStr);

      if (isNaN(first) || isNaN(second)) {
        return null;
      }

      let result;
      switch (operator) {
        case '+':
          result = first + second;
          break;
        case '-':
          result = first - second;
          break;
        case '*':
          result = first * second;
          break;
        case '/':
          if (second === 0) {
            return "Division by zero isn't defined. Try another problem!";
          }
          result = first / second;
          break;
        default:
          return null;
      }

      const formatted = `${first} ${operator} ${second} = ${result}`;
      const steps = [
        `1. Identify the numbers: ${first} and ${second}`,
        `2. Apply the operation (${operator})`,
        `3. Calculate: ${formatted}`
      ].join('\n');

      return `**${formatted}**\n\nHere’s how to solve it:\n${steps}`;
    } catch (error) {
      return null;
    }
  }

  buildFriendlyIntro(message, studentName) {
    const trimmed = (message || '').trim().toLowerCase();
    if (!trimmed) {
      return `Hi ${studentName}!`;
    }

    const greetingRegex = /^(hi|hello|hey|good (morning|afternoon|evening))/;
    if (greetingRegex.test(trimmed)) {
      return `Hi ${studentName}! 👋`;
    }

    const appreciationPhrases = [
      `Great question, ${studentName}!`,
      `Excellent doubt, ${studentName}!`,
      `Fantastic curiosity, ${studentName}!`,
      `Love that you're exploring this, ${studentName}!`
    ];

    return appreciationPhrases[Math.floor(Math.random() * appreciationPhrases.length)];
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
      
      // Include instruction in the prompt since systemInstruction is not supported in v1 API
      const instruction = format === 'json' 
        ? 'You are a helpful assistant. Respond ONLY with valid JSON, no markdown, no code blocks, just pure JSON.\n\n'
        : 'You are a helpful assistant. Provide clear, structured responses.\n\n';
      
      const fullPrompt = instruction + prompt;

      const result = await model.generateContent(fullPrompt);

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

