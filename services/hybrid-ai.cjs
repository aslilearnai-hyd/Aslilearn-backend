const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8');

class HybridAIService {
  constructor() {
    this.geminiModel = null;
    this.isGeminiAvailable = false;
    this.initializeGemini();
  }

  async initializeGemini() {
    try {
      // Try to initialize Gemini with different model names and API versions
      const models = [
        { name: 'gemini-1.5-flash', version: 'v1beta' },
        { name: 'gemini-pro', version: 'v1beta' },
        { name: 'gemini-1.5-pro', version: 'v1beta' },
        { name: 'gemini-1.5-flash', version: 'v1' },
        { name: 'gemini-pro', version: 'v1' }
      ];
      
      for (const model of models) {
        try {
          this.geminiModel = genAI.getGenerativeModel({ model: model.name });
          // Test with a simple request
          const result = await this.geminiModel.generateContent('Hello');
          await result.response;
          this.isGeminiAvailable = true;
          console.log(`✅ Gemini API working with model: ${model.name} (${model.version})`);
          break;
        } catch (error) {
          console.log(`❌ Gemini model ${model.name} (${model.version}) failed: ${error.message}`);
        }
      }
      
      if (!this.isGeminiAvailable) {
        console.log('⚠️ Gemini API not available, using enhanced mock service with direct math solving');
      }
    } catch (error) {
      console.log('⚠️ Gemini API initialization failed, using enhanced mock service with direct math solving');
    }
  }

  async generateResponse(message, context = {}, chatHistory = []) {
    // Try Gemini first if available
    if (this.isGeminiAvailable && this.geminiModel) {
      try {
        return await this.generateGeminiResponse(message, context, chatHistory);
      } catch (error) {
        console.log('Gemini API failed, falling back to enhanced mock:', error.message);
        this.isGeminiAvailable = false;
      }
    }
    
    // Fall back to enhanced mock service
    return await this.generateEnhancedMockResponse(message, context, chatHistory);
  }

  async generateGeminiResponse(message, context = {}, chatHistory = []) {
    // Build context-aware prompt
    let systemPrompt = `You are a Vidya AI for Asli Learn Foundation, an educational platform. You help students with their studies across various subjects including Physics, Chemistry, Mathematics, and Biology.

Your role is to:
1. Provide clear, educational explanations
2. Break down complex concepts into understandable parts
3. Give step-by-step solutions to problems
4. Encourage learning and provide study tips
5. Be supportive and patient with students

Guidelines:
- Always explain concepts clearly with examples
- Use appropriate academic language but keep it accessible
- Provide step-by-step solutions for math and science problems
- Encourage students to understand the reasoning behind solutions
- If you don't know something, admit it and suggest resources`;

    // Add context if available
    if (context.currentSubject) {
      systemPrompt += `\n\nCurrent Study Context: The student is currently studying ${context.currentSubject}`;
      if (context.currentTopic) {
        systemPrompt += `, specifically focusing on ${context.currentTopic}`;
      }
    }

    // Build conversation history
    let conversationHistory = '';
    if (chatHistory.length > 0) {
      conversationHistory = '\n\nPrevious conversation:\n';
      chatHistory.slice(-10).forEach(msg => {
        conversationHistory += `${msg.role === 'user' ? 'Student' : 'Vidya AI'}: ${msg.content}\n`;
      });
    }

    const fullPrompt = `${systemPrompt}${conversationHistory}\n\nStudent: ${message}\n\nVidya AI:`;

    const result = await this.geminiModel.generateContent(fullPrompt);
    const response = await result.response;
    return response.text();
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

  async generateEnhancedMockResponse(message, context = {}, chatHistory = []) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    
    // Enhanced responses based on message content
    let response = '';
    
    // Math-related responses
    if (message.includes('+') || message.includes('-') || message.includes('*') || message.includes('/') || 
        message.includes('=') || message.includes('math') || message.includes('calculate')) {
      
      // Try to solve simple math problems directly
      const mathResult = this.solveMathProblem(message);
      if (mathResult) {
        response = mathResult;
      } else {
        response = "I can help you with that math problem! Let me break it down step by step:\n\n";
        response += "Let me help you solve this step by step. ";
        response += "First, let's identify what operation we need to perform. ";
        response += "Then I'll show you the method to solve it.";
      }
    }
    // Physics-related responses
    else if (message.toLowerCase().includes('physics') || message.toLowerCase().includes('motion') || 
             message.toLowerCase().includes('force') || message.toLowerCase().includes('energy')) {
      response = "Great physics question! Let me explain this concept clearly:\n\n";
      response += "In physics, we use scientific principles to understand how things work. ";
      response += "Let me break this down into manageable parts and provide examples. ";
      response += "Remember, physics is about understanding the 'why' behind natural phenomena.";
    }
    // Chemistry-related responses
    else if (message.toLowerCase().includes('chemistry') || message.toLowerCase().includes('molecule') || 
             message.toLowerCase().includes('atom') || message.toLowerCase().includes('reaction')) {
      response = "Excellent chemistry question! Let me help you understand this:\n\n";
      response += "Chemistry is the study of matter and how it changes. ";
      response += "I'll explain the concepts using clear examples and show you how to apply them. ";
      response += "Understanding molecular structure is key to mastering chemistry.";
    }
    // Biology-related responses
    else if (message.toLowerCase().includes('biology') || message.toLowerCase().includes('cell') || 
             message.toLowerCase().includes('organism') || message.toLowerCase().includes('life')) {
      response = "Fascinating biology question! Let me explain this biological concept:\n\n";
      response += "Biology helps us understand living systems and how they function. ";
      response += "I'll break down the processes and show you how different components work together. ";
      response += "Remember, biology is about understanding life at all levels.";
    }
    // General educational responses
    else {
      const responses = [
        "That's a great question! Let me help you understand this concept step by step.",
        "I'm here to help you learn! Let me break this down into manageable parts.",
        "Excellent question! This is an important concept to master. Let me explain it clearly.",
        "I can definitely help you with this! Let me provide a detailed explanation.",
        "That's a thoughtful question! Let me walk you through the solution step by step."
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

  async analyzeImage(imageBase64, context = '') {
    // Try Gemini first if available
    if (this.isGeminiAvailable && this.geminiModel) {
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
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
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

const hybridAIService = new HybridAIService();

module.exports = { hybridAIService };
