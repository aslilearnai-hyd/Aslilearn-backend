#!/bin/bash
# Startup script with optional Ollama

echo "🚀 Starting backend with Ollama..."

# Find Node.js in PATH or common locations
NODE_CMD="node"
if ! command -v node &> /dev/null; then
  # Try common Node.js locations
  if [ -f "/usr/bin/node" ]; then
    NODE_CMD="/usr/bin/node"
  elif [ -f "/usr/local/bin/node" ]; then
    NODE_CMD="/usr/local/bin/node"
  elif [ -f "$HOME/.nvm/versions/node/*/bin/node" ]; then
    NODE_CMD=$(find $HOME/.nvm/versions/node -name node | head -1)
  else
    echo "❌ Node.js not found! Trying to use system node..."
    # Use which node or fail
    NODE_CMD=$(which node || echo "node")
  fi
fi

echo "📦 Using Node.js: $NODE_CMD"
$NODE_CMD --version || echo "⚠️ Warning: Could not verify Node.js version"

# Try to start Ollama (optional - will use fallback if it fails)
echo "📦 Attempting to start Ollama service..."
if command -v ollama &> /dev/null; then
  ollama serve &
  OLLAMA_PID=$!
  
  # Wait for Ollama to be ready
  echo "⏳ Waiting for Ollama to start..."
  sleep 10
  
  # Check if Ollama is running
  if curl -f http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama is running"
    
    # Download model if not exists
    echo "📥 Checking for model..."
    MODEL_EXISTS=$(curl -s http://localhost:11434/api/tags | grep -o "llama3.2:1b" || echo "")
    
    if [ -z "$MODEL_EXISTS" ]; then
      echo "📥 Downloading llama3.2:1b model..."
      ollama pull llama3.2:1b || echo "⚠️ Model download failed, will use fallback"
    else
      echo "✅ Model already exists"
    fi
  else
    echo "⚠️ Ollama failed to start, will use fallback responses"
  fi
else
  echo "⚠️ Ollama not found, will use fallback responses"
fi

# Start Node.js application
echo "🚀 Starting Node.js application..."
exec $NODE_CMD index.js

