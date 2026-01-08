#!/bin/bash

# PDF Extraction Setup Script
echo "🔧 Setting up PDF extraction for Teacher AI Tools..."

# Check Python installation
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.7 or higher."
    exit 1
fi

echo "✅ Python found: $(python3 --version)"

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip3 install pdfplumber PyPDF2

if [ $? -eq 0 ]; then
    echo "✅ Python dependencies installed successfully"
else
    echo "❌ Failed to install Python dependencies"
    echo "Try: pip3 install pdfplumber PyPDF2"
    exit 1
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p uploads/pdfs
mkdir -p uploads/extracted

# Make PDF extractor executable
chmod +x scripts/pdf-extractor.py

echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Start your backend server"
echo "2. Upload a PDF from the teacher dashboard"
echo "3. Use AI tools with extracted content"
echo ""
echo "💡 Test extraction manually:"
echo "   python3 scripts/pdf-extractor.py <pdf_path> <output_dir> <class> <subject> <topic>"


