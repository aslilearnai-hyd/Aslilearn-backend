// Qwen Service - OpenAI-compatible API wrapper
// Replaces Gemini service with Qwen 2.5 7B Instruct

const axios = require('axios');

class DeepSeekService {
  constructor() {
    this.apiUrl = process.env.DEEPSEEK_API_URL || 'http://localhost:8000/v1';
    this.model = 'qwen2.5-7b-instruct';
    
    if (!this.apiUrl) {
      console.warn('⚠️  DEEPSEEK_API_URL not set, using default: http://localhost:8000');
    } else {
      console.log('✅ DeepSeek service initialized');
      console.log(`📍 API URL: ${this.apiUrl}`);
    }
  }

  async generateResponse(message, context = {}, chatHistory = []) {
    try {
      console.log('🤖 Using Qwen 2.5 7B Instruct for response...');
      
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

      // Build messages array
      const messages = [
        { role: 'system', content: systemInstruction }
      ];

      // Add chat history (last 5 messages)
      if (chatHistory.length > 0) {
        chatHistory.slice(-5).forEach(msg => {
          messages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          });
        });
      }

      // Add current message
      messages.push({ role: 'user', content: message });

      // Call DeepSeek API
      const response = await axios.post(
        `${this.apiUrl}/chat/completions`,
        {
          model: this.model,
          messages: messages,
          temperature: 0.7,
          max_tokens: 2000
        },
        {
          timeout: 60000 // 60 seconds timeout
        }
      );

      const responseText = response.data.choices[0].message.content;
      console.log(`✅ DeepSeek response received (${responseText.length} characters)`);
      return responseText;
    } catch (error) {
      console.error('❌ DeepSeek API error:', error.message);
      // Fallback to enhanced response
      return await this.generateEnhancedResponse(message, context, chatHistory);
    }
  }

  async generateEnhancedResponse(message, context = {}, chatHistory = []) {
    // Enhanced fallback responses (same as Gemini)
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

      return `**${formatted}**\n\nHere's how to solve it:\n${steps}`;
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
    // Qwen 2.5 7B doesn't support vision yet, fallback to text extraction
    console.log('⚠️  Image analysis not supported by Qwen 2.5 7B, using fallback');
    return await this.analyzeImageMock(imageBase64, context);
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
      const systemInstruction = format === 'json' 
        ? 'You are a helpful assistant. Respond ONLY with valid JSON, no markdown, no code blocks, just pure JSON.'
        : 'You are a helpful assistant. Provide clear, structured responses.';

      const messages = [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt }
      ];

      const response = await axios.post(
        `${this.apiUrl}/chat/completions`,
        {
          model: this.model,
          messages: messages,
          temperature: 0.3, // Lower temperature for structured output
          max_tokens: 4000
        },
        {
          timeout: 120000 // 2 minutes for longer content
        }
      );

      let resultText = response.data.choices[0].message.content;

      // Clean JSON if format is json
      if (format === 'json') {
        resultText = resultText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      }

      return resultText;
    } catch (error) {
      console.error('DeepSeek structured content error:', error);
      throw new Error(`Failed to generate content: ${error.message}`);
    }
  }
}

const deepseekService = new DeepSeekService();

module.exports = { deepseekService };

