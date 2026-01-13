@echo off
REM PDF Extraction Setup Script for Windows

echo 🔧 Setting up PDF extraction for Teacher AI Tools...

REM Check Python installation
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python is not installed. Please install Python 3.7 or higher.
    exit /b 1
)

echo ✅ Python found
python --version

REM Install Python dependencies
echo 📦 Installing Python dependencies...
pip install pdfplumber PyPDF2

if errorlevel 1 (
    echo ❌ Failed to install Python dependencies
    echo Try: pip install pdfplumber PyPDF2
    exit /b 1
)

echo ✅ Python dependencies installed successfully

REM Create necessary directories
echo 📁 Creating directories...
if not exist "uploads\pdfs" mkdir uploads\pdfs
if not exist "uploads\extracted" mkdir uploads\extracted

echo ✅ Setup complete!
echo.
echo 📝 Next steps:
echo 1. Start your backend server
echo 2. Upload a PDF from the teacher dashboard
echo 3. Use AI tools with extracted content
echo.
echo 💡 Test extraction manually:
echo    python scripts\pdf-extractor.py ^<pdf_path^> ^<output_dir^> ^<class^> ^<subject^> ^<topic^>






