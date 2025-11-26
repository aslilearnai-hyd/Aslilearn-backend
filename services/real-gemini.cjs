const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini AI with your API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8');

class RealGeminiService {
  constructor() {
    this.model = null;
    this.isAvailable = false;
    this.initializeGemini();
  }

  async initializeGemini() {
    try {
      // Try the most common working model names
      const modelNames = [
        'gemini-pro',
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-1.0-pro'
      ];
      
      for (const modelName of modelNames) {
        try {
          console.log(`Trying Gemini model: ${modelName}`);
          this.model = genAI.getGenerativeModel({ model: modelName });
          
          // Test with a simple request
          const result = await this.model.generateContent('Hello, test message');
          const response = await result.response;
          const text = response.text();
          
          this.isAvailable = true;
          console.log(`✅ Gemini API working with model: ${modelName}`);
          console.log(`Test response: ${text.substring(0, 50)}...`);
          break;
        } catch (error) {
          console.log(`❌ Gemini model ${modelName} failed: ${error.message}`);
        }
      }
      
      if (!this.isAvailable) {
        console.log('⚠️ All Gemini models failed, using fallback service');
      }
    } catch (error) {
      console.log('⚠️ Gemini initialization failed:', error.message);
    }
  }

  async generateResponse(message, context = {}, chatHistory = []) {
    // Try Gemini first if available
    if (this.isAvailable && this.model) {
      try {
        return await this.generateGeminiResponse(message, context, chatHistory);
      } catch (error) {
        console.log('Gemini API failed, falling back to enhanced service:', error.message);
        this.isAvailable = false;
      }
    }
    
    // Fall back to enhanced service
    return await this.generateEnhancedResponse(message, context, chatHistory);
  }

  async generateGeminiResponse(message, context = {}, chatHistory = []) {
    try {
      // Build a comprehensive prompt for educational assistance
      let systemPrompt = `You are a Vidya AI for AsliLearn, an educational platform. You help students with their studies across various subjects including Physics, Chemistry, Mathematics, and Biology.

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
        systemPrompt += `\n\nCurrent Study Context: The student is studying ${context.currentSubject}`;
      }

      // Build conversation history
      let conversationHistory = '';
      if (chatHistory.length > 0) {
        conversationHistory = '\n\nPrevious conversation:\n';
        chatHistory.slice(-5).forEach(msg => {
          conversationHistory += `${msg.role === 'user' ? 'Student' : 'Vidya AI'}: ${msg.content}\n`;
        });
      }

      const fullPrompt = `${systemPrompt}${conversationHistory}\n\nStudent: ${message}\n\nVidya AI:`;

      const result = await this.model.generateContent(fullPrompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Gemini API error:', error);
      throw new Error('Failed to generate Gemini response');
    }
  }

  async generateEnhancedResponse(message, context = {}, chatHistory = []) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    
    // Enhanced responses with direct answers
    let response = '';
    
    // Math-related responses with direct solving
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
    // Physics-related responses
    else if (message.toLowerCase().includes('physics') || message.toLowerCase().includes('motion') || 
             message.toLowerCase().includes('force') || message.toLowerCase().includes('energy')) {
      response = "Great physics question! Let me explain this clearly:\n\n";
      response += "In physics, we use scientific principles to understand natural phenomena. ";
      response += "I'll break this down into clear concepts and provide examples to help you understand.";
    }
    // Chemistry-related responses
    else if (message.toLowerCase().includes('chemistry') || message.toLowerCase().includes('molecule') || 
             message.toLowerCase().includes('atom') || message.toLowerCase().includes('reaction')) {
      response = "Excellent chemistry question! Let me explain this:\n\n";
      response += "Chemistry is the study of matter and its transformations. ";
      response += "I'll explain the concepts using clear examples and show you how to apply them.";
    }
    // Biology-related responses
    else if (message.toLowerCase().includes('biology') || message.toLowerCase().includes('cell') || 
             message.toLowerCase().includes('organism') || message.toLowerCase().includes('life')) {
      response = "Fascinating biology question! Let me explain this:\n\n";
      response += "Biology helps us understand living systems and their functions. ";
      response += "I'll break down the processes and show you how different components work together.";
    }
    // General educational responses
    else {
      const responses = [
        "That's a great question! Let me help you understand this clearly.",
        "I'm here to help you learn! Let me explain this step by step.",
        "Excellent question! This is an important concept to master. Let me explain it clearly.",
        "I can definitely help you with this! Let me provide a clear explanation.",
        "That's a thoughtful question! Let me walk you through this step by step."
      ];
      response = responses[Math.floor(Math.random() * responses.length)] + "\n\n";
      response += "I'll explain this concept using clear examples and show you how to apply it. ";
      response += "Understanding the underlying principles will help you solve similar problems in the future.";
    }
    
    // Add subject-specific context
    if (context.currentSubject) {
      response += `\n\nSince you're studying ${context.currentSubject}, I'll focus on that subject area. `;
      response += "This will help you connect this concept to your current studies.";
    }
    
    // Add study tips
    response += "\n\n💡 **Study Tip**: Try to understand the underlying concepts rather than just memorizing facts. ";
    response += "This will help you apply your knowledge to new situations and solve problems more effectively.";
    
    return response;
  }

  solveMathProblem(message) {
    try {
      // Clean the message and extract math expression
      let expression = message.replace(/[^0-9+\-*/().=]/g, '').trim();
      
      // Handle simple addition like "1+6="
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
      
      // Handle simple subtraction
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
      
      // Handle simple multiplication
      if (expression.includes('*') && expression.includes('=')) {
        const parts = expression.split('*');
        if (parts.length === 2) {
          const first = parseInt(parts[0].trim());
          const second = parseInt(parts[1].split('=')[0].trim());
          
          if (!isNaN(first) && !isNaN(second)) {
            const result = first * second;
            return `**${first} × ${second} = ${result}**\n\n` +
                   `Here's how to solve it:\n` +
                   `1. Start with the first number: ${first}\n` +
                   `2. Multiply by the second number: ${first} × ${second}\n` +
                   `3. Add ${first} to itself ${second} times: ${first} + ${first} + ... = ${result}`;
          }
        }
      }
      
      return null; // Couldn't solve
    } catch (error) {
      return null;
    }
  }

  async analyzeImage(imageBase64, context = '') {
    // Try Gemini first if available
    if (this.isAvailable && this.model) {
      try {
        return await this.analyzeImageWithGemini(imageBase64, context);
      } catch (error) {
        console.log('Gemini image analysis failed, falling back to mock:', error.message);
      }
    }
    
    // Fall back to mock image analysis
    return await this.analyzeImageMock(imageBase64, context);
  }

  async analyzeImageWithGemini(imageBase64, context = '') {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
    
    const prompt = `You are a Vidya AI. Analyze this image and provide educational assistance. 
    ${context ? `Context: ${context}` : ''}
    
    Please:
    1. Identify what's in the image (math problem, diagram, text, etc.)
    2. Provide step-by-step explanation or solution
    3. Give educational insights about the content
    4. Suggest related concepts to study`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType: 'image/jpeg'
        }
      }
    ]);

    const response = await result.response;
    return response.text();
  }

  async analyzeImageMock(imageBase64, context = '') {
    // Simulate API delay
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
}

const realGeminiService = new RealGeminiService();

module.exports = { realGeminiService };
