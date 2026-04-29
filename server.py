from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uvicorn
import os
from llama_cpp import Llama

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = os.path.expanduser("~/models/deepseek-v3-Q4_K_M.gguf")

print("🔄 Loading DeepSeek-V3 model...")
ai_model = None
try:
    if os.path.exists(MODEL_PATH):
        ai_model = Llama(
            model_path=MODEL_PATH,
            n_ctx=4096,
            n_threads=2,
            n_gpu_layers=0,
            verbose=False
        )
        print("✅ Model loaded successfully!")
    else:
        print(f"❌ Model file not found at: {MODEL_PATH}")
except Exception as e:
    print(f"❌ Error loading model: {e}")
    ai_model = None

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model: str = "deepseek-v3"
    messages: List[Message]
    temperature: float = 0.7
    max_tokens: Optional[int] = 2000

@app.get("/health")
async def health():
    return {
        "status": "ok" if ai_model else "error",
        "model": "deepseek-v3",
        "model_loaded": ai_model is not None
    }

@app.post("/v1/chat/completions")
async def chat_completions(request: ChatRequest):
    if not ai_model:
        return {"error": {"message": "Model not loaded"}}, 500
    
    try:
        prompt = ""
        for msg in request.messages:
            if msg.role == "system":
                prompt += f"System: {msg.content}\n\n"
            elif msg.role == "user":
                prompt += f"User: {msg.content}\n\n"
            elif msg.role == "assistant":
                prompt += f"Assistant: {msg.content}\n\n"
        
        prompt += "Assistant: "
        
        response = ai_model(
            prompt,
            max_tokens=request.max_tokens or 2000,
            temperature=request.temperature,
            stop=["User:", "System:"],
            echo=False
        )
        
        generated_text = response["choices"][0]["text"].strip()
        prompt_tokens = len(prompt.split())
        completion_tokens = len(generated_text.split())
        
        return {
            "id": f"chatcmpl-{hash(prompt)}",
            "object": "chat.completion",
            "created": 1234567890,
            "model": "deepseek-v3",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": generated_text
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens
            }
        }
    except Exception as e:
        return {"error": {"message": str(e)}}, 500

if __name__ == "__main__":
    print("🚀 Starting DeepSeek-V3 API server...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")