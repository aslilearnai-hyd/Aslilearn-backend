const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_FALLBACKS = 'gemini-1.5-flash,gemini-1.5-pro,gemini-2.5-flash-lite,gemini-2.0-flash';

export const getRouterConfig = () => {
  const apiKey = String(process.env.VIDYA_AI_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  const model = String(process.env.VIDYA_AI_GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const fallbackModels = String(process.env.VIDYA_AI_GEMINI_FALLBACK_MODELS || DEFAULT_FALLBACKS)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .filter((m) => m !== model);
  const baseUrl = (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/+$/,
    ''
  );
  const anthropicKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  const anthropicModel = String(process.env.ANTHROPIC_FALLBACK_MODEL || 'claude-3-5-haiku-latest').trim();
  const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const openaiModel = String(process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini').trim();
  return {
    gemini: { apiKey, model, fallbackModels, baseUrl },
    anthropic: { apiKey: anthropicKey, model: anthropicModel },
    openai: { apiKey: openaiKey, model: openaiModel },
  };
};

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
];

const extractGeminiText = (payload) => {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
};

const extractGeminiSafety = (payload) => {
  const candidate = payload?.candidates?.[0];
  if (!candidate) return null;
  const finish = candidate.finishReason || '';
  if (String(finish).toUpperCase() === 'SAFETY') {
    return { reason: 'SAFETY', ratings: candidate.safetyRatings || [] };
  }
  if (payload?.promptFeedback?.blockReason) {
    return { reason: payload.promptFeedback.blockReason, ratings: payload.promptFeedback.safetyRatings || [] };
  }
  return null;
};

const parseGeminiError = (errorText) => {
  try {
    const parsed = JSON.parse(errorText);
    return parsed?.error?.message ? String(parsed.error.message) : String(errorText || '');
  } catch (_) {
    return String(errorText || '');
  }
};

const buildGeminiPayload = ({ systemInstruction, contents, generationConfig }) => ({
  systemInstruction: { parts: [{ text: systemInstruction }] },
  contents,
  generationConfig: {
    temperature: 0.4,
    maxOutputTokens: 1400,
    ...(generationConfig || {}),
  },
  safetySettings: SAFETY_SETTINGS,
});

export const buildContentsFromHistory = ({ history = [], userMessage, attachments = [] }) => {
  const historyContents = (Array.isArray(history) ? history : [])
    .slice(-8)
    .map((msg) => {
      const text = String(msg?.content || '').trim();
      if (!text) return null;
      return {
        role: msg?.role === 'assistant' ? 'model' : 'user',
        parts: [{ text }],
      };
    })
    .filter(Boolean);

  const userParts = [{ text: String(userMessage || '').trim() || 'Help me with my studies.' }];
  for (const att of attachments) {
    if (att?.mime && att?.data) {
      userParts.push({ inline_data: { mime_type: att.mime, data: att.data } });
    }
  }

  return [...historyContents, { role: 'user', parts: userParts }];
};

const getGeminiTimeoutMs = () => {
  const n = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(n) && n > 5000 ? n : 120000;
};

const callGeminiOnce = async ({ apiKey, baseUrl, modelName, payload }) => {
  const url = `${baseUrl}/models/${modelName}:generateContent?key=${apiKey}`;
  const timeoutMs = getGeminiTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    const msg = fetchErr?.name === 'AbortError' ? `Request timed out after ${timeoutMs}ms` : String(fetchErr?.message || fetchErr);
    const error = new Error(`Vidya model ${modelName} fetch failed: ${msg}`);
    error.statusCode = 0;
    error.modelName = modelName;
    console.error('[Vidya Gemini API]', modelName, msg);
    throw error;
  }
  clearTimeout(timer);
  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(
      `Vidya model ${modelName} failed (${response.status}): ${parseGeminiError(errorText)}`
    );
    error.statusCode = response.status;
    error.modelName = modelName;
    console.error('[Vidya Gemini API]', modelName, response.status, parseGeminiError(errorText).slice(0, 400));
    throw error;
  }
  const data = await response.json();
  const text = extractGeminiText(data);
  const safety = extractGeminiSafety(data);
  return { text, safety, modelName, raw: data };
};

const callAnthropic = async ({ systemInstruction, contents, generationConfig }) => {
  const { apiKey, model } = getRouterConfig().anthropic;
  if (!apiKey) throw new Error('Anthropic key not configured');
  const messages = contents
    .filter((c) => c.role === 'user' || c.role === 'model')
    .map((c) => ({
      role: c.role === 'model' ? 'assistant' : 'user',
      content: c.parts
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n'),
    }))
    .filter((m) => m.content);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: generationConfig?.maxOutputTokens || 1400,
      temperature: generationConfig?.temperature ?? 0.4,
      system: systemInstruction,
      messages,
    }),
  });
  if (!response.ok) {
    const t = await response.text();
    const err = new Error(`Vidya emergency model failed (${response.status}): ${t.slice(0, 200)}`);
    err.statusCode = response.status;
    throw err;
  }
  const data = await response.json();
  const text = (data?.content || [])
    .map((c) => (typeof c?.text === 'string' ? c.text : ''))
    .join('')
    .trim();
  return { text, safety: null, modelName: `anthropic:${model}`, raw: data };
};

const callOpenAI = async ({ systemInstruction, contents, generationConfig }) => {
  const { apiKey, model } = getRouterConfig().openai;
  if (!apiKey) throw new Error('OpenAI key not configured');
  const messages = [
    { role: 'system', content: systemInstruction },
    ...contents
      .filter((c) => c.role === 'user' || c.role === 'model')
      .map((c) => ({
        role: c.role === 'model' ? 'assistant' : 'user',
        content: c.parts.map((p) => p.text || '').filter(Boolean).join('\n'),
      }))
      .filter((m) => m.content),
  ];
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: generationConfig?.temperature ?? 0.4,
      max_tokens: generationConfig?.maxOutputTokens || 1400,
      messages,
    }),
  });
  if (!response.ok) {
    const t = await response.text();
    const err = new Error(`Vidya emergency model failed (${response.status}): ${t.slice(0, 200)}`);
    err.statusCode = response.status;
    throw err;
  }
  const data = await response.json();
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  return { text, safety: null, modelName: `openai:${model}`, raw: data };
};

const tryCrossVendorFallback = async ({ systemInstruction, contents, generationConfig }) => {
  const { anthropic, openai } = getRouterConfig();
  const order = String(process.env.VIDYA_EMERGENCY_FALLBACK || 'anthropic,openai')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const vendor of order) {
    try {
      if (vendor === 'anthropic' && anthropic.apiKey) {
        return await callAnthropic({ systemInstruction, contents, generationConfig });
      }
      if (vendor === 'openai' && openai.apiKey) {
        return await callOpenAI({ systemInstruction, contents, generationConfig });
      }
    } catch (err) {
      console.warn(`Cross-vendor fallback ${vendor} failed:`, err.message);
    }
  }
  return null;
};

export const callModel = async ({
  systemInstruction,
  contents,
  generationConfig,
}) => {
  const { gemini } = getRouterConfig();
  if (!gemini.apiKey) {
    throw new Error('Vidya is not configured (missing API key).');
  }
  const payload = buildGeminiPayload({ systemInstruction, contents, generationConfig });
  const fallbackChain = [];
  const models = [gemini.model, ...gemini.fallbackModels];
  let lastError = null;
  let lastSafety = null;

  for (const modelName of models) {
    fallbackChain.push(`gemini:${modelName}`);
    try {
      const result = await callGeminiOnce({
        apiKey: gemini.apiKey,
        baseUrl: gemini.baseUrl,
        modelName,
        payload,
      });
      if (result.safety) {
        lastSafety = result.safety;
      }
      if (!result.text) {
        lastError = new Error(`Empty response from ${modelName}`);
        continue;
      }
      return {
        text: result.text,
        modelName: `gemini:${modelName}`,
        provider: 'gemini',
        fallbackChain,
        safety: result.safety,
      };
    } catch (err) {
      lastError = err;
      const status = err.statusCode || 0;
      console.error('[Vidya Gemini API Error]', modelName, err?.message || err);
      if (status === 429 || status === 503 || status === 404 || status === 500 || status === 0) {
        continue;
      }
      break;
    }
  }

  const cross = await tryCrossVendorFallback({ systemInstruction, contents, generationConfig });
  if (cross) {
    fallbackChain.push(cross.modelName);
    return {
      text: cross.text,
      modelName: cross.modelName,
      provider: cross.modelName.startsWith('anthropic') ? 'anthropic' : 'openai',
      fallbackChain,
      safety: null,
    };
  }

  if (lastSafety) {
    const e = new Error('Vidya could not answer that one (safety block).');
    e.statusCode = 451;
    e.safety = lastSafety;
    e.fallbackChain = fallbackChain;
    throw e;
  }

  const finalError = lastError || new Error('Vidya is briefly unavailable.');
  finalError.fallbackChain = fallbackChain;
  console.error('[Vidya Gemini API] All Gemini models failed; emergency fallback exhausted.', finalError.message);
  throw finalError;
};

export const streamGeminiModel = async ({
  systemInstruction,
  contents,
  generationConfig,
  onToken,
  onSafety,
}) => {
  const { gemini } = getRouterConfig();
  if (!gemini.apiKey) {
    throw new Error('Vidya is not configured (missing API key).');
  }
  const payload = buildGeminiPayload({ systemInstruction, contents, generationConfig });
  const fallbackChain = [];
  const models = [gemini.model, ...gemini.fallbackModels];
  let lastError = null;
  let producedAny = false;
  let lastSafety = null;

  for (const modelName of models) {
    fallbackChain.push(`gemini:${modelName}`);
    const url = `${gemini.baseUrl}/models/${modelName}:streamGenerateContent?alt=sse&key=${gemini.apiKey}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => '');
        const err = new Error(
          `Vidya stream ${modelName} failed (${response.status}): ${parseGeminiError(errorText)}`
        );
        err.statusCode = response.status;
        lastError = err;
        if ([429, 503, 404, 500].includes(response.status)) continue;
        break;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let collected = '';
      let done = false;

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = event
              .split('\n')
              .map((l) => l.trim())
              .find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            const jsonStr = dataLine.slice('data:'.length).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const json = JSON.parse(jsonStr);
              const safety = extractGeminiSafety(json);
              if (safety) {
                lastSafety = safety;
                if (typeof onSafety === 'function') onSafety(safety);
              }
              const piece = extractGeminiText(json);
              if (piece) {
                collected += piece;
                producedAny = true;
                if (typeof onToken === 'function') onToken(piece);
              }
            } catch (_) {}
          }
        }
      }

      if (collected.trim().length > 0) {
        return {
          text: collected,
          modelName: `gemini:${modelName}`,
          provider: 'gemini',
          fallbackChain,
          safety: lastSafety,
        };
      }
      lastError = new Error(`Empty stream from ${modelName}`);
    } catch (err) {
      lastError = err;
      const status = err.statusCode || 0;
      if (status === 429 || status === 503 || status === 404 || status === 500 || status === 0) {
        continue;
      }
      break;
    }
  }

  if (!producedAny) {
    const cross = await tryCrossVendorFallback({ systemInstruction, contents, generationConfig });
    if (cross) {
      fallbackChain.push(cross.modelName);
      if (typeof onToken === 'function') {
        onToken(cross.text);
      }
      return {
        text: cross.text,
        modelName: cross.modelName,
        provider: cross.modelName.startsWith('anthropic') ? 'anthropic' : 'openai',
        fallbackChain,
        safety: null,
      };
    }
  }

  if (lastSafety) {
    const e = new Error('Vidya could not answer that one (safety block).');
    e.statusCode = 451;
    e.safety = lastSafety;
    e.fallbackChain = fallbackChain;
    throw e;
  }

  const err = lastError || new Error('Vidya is briefly unavailable.');
  err.fallbackChain = fallbackChain;
  throw err;
};

export default { callModel, streamGeminiModel, getRouterConfig, buildContentsFromHistory };
