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

# DeepSeek V2 Q3_K_M model - supports both single file and sharded files
# llama-cpp-python will auto-detect all shards if multiple files exist
MODEL_DIR = os.path.expanduser("~/models/DeepSeek-V2-Q3_K_M")
MODEL_PATH = None

print("🔄 Loading DeepSeek-V2 Q3_K_M model...")
llm = None
try:
    # Check if directory exists
    if os.path.exists(MODEL_DIR):
        # Look for model files (could be single file or sharded)
        gguf_files = [f for f in os.listdir(MODEL_DIR) if f.endswith('.gguf')]
        
        if gguf_files:
            # If sharded, use the first shard (llama-cpp-python will auto-detect others)
            # If single file, use that file
            if any('00001-of-' in f for f in gguf_files):
                # Sharded model - find first shard
                first_shard = sorted([f for f in gguf_files if '00001-of-' in f])[0]
                MODEL_PATH = os.path.join(MODEL_DIR, first_shard)
                print(f"📁 Loading sharded model from: {MODEL_PATH}")
                print("💡 llama-cpp-python will automatically use all sharded files")
            else:
                # Single file model
                MODEL_PATH = os.path.join(MODEL_DIR, sorted(gguf_files)[0])
                print(f"📁 Loading single file model from: {MODEL_PATH}")
            
            llm = Llama(
                model_path=MODEL_PATH,
                n_ctx=4096,
                n_threads=2,  # 2 vCPUs on your droplet
                n_gpu_layers=0,
                verbose=False
            )
            print("✅ Model loaded successfully!")
        else:
            print(f"❌ No .gguf files found in: {MODEL_DIR}")
            print("💡 Make sure the model files are in: ~/models/DeepSeek-V2-Q3_K_M/")
    else:
        print(f"❌ Model directory not found: {MODEL_DIR}")
        print("💡 Make sure the model files are downloaded to: ~/models/DeepSeek-V2-Q3_K_M/")
except Exception as e:
    print(f"❌ Error loading model: {e}")
    import traceback
    traceback.print_exc()
    llm = None

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model: str = "deepseek-v2"
    messages: List[Message]
    temperature: float = 0.7
    max_tokens: Optional[int] = 2000

@app.get("/health")
async def health():
    return {
        "status": "ok" if llm else "error",
        "model": "deepseek-v2-q3_k_m",
        "model_loaded": llm is not None
    }

@app.post("/v1/chat/completions")
async def chat_completions(request: ChatRequest):
    if not llm:
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
        
        response = llm(
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
            "model": "deepseek-v2",
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
    print("🚀 Starting DeepSeek-V2 API server...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")