const geminiService = {
  async generateResponse(message, context = {}, chatHistory = []) {
    const mod = await import('./gemini-service.js');
    return mod.default.generateResponse(message, context, chatHistory);
  },

  async analyzeImage(imageBase64, context = '') {
    const mod = await import('./gemini-service.js');
    return mod.default.analyzeImage(imageBase64, context);
  },

  async generateStructuredContent(prompt, format = 'text') {
    const mod = await import('./gemini-service.js');
    return mod.default.generateStructuredContent(prompt, format);
  },
};

module.exports = { geminiService };

