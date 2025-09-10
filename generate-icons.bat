@echo off
echo 🎨 Canvas-Notion Sync - Icon Generator
echo =====================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed or not in PATH
    echo 💡 Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo ✅ Node.js found
echo.

REM Try to generate icons with canvas library first
echo 🔄 Attempting to generate PNG icons with canvas library...
npm install canvas --silent >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Canvas library installed successfully
    node generate-icons.js
) else (
    echo ⚠️  Canvas library installation failed (this is normal on some systems)
    echo 🔄 Generating SVG icons instead...
    node generate-icons.js
)

echo.
echo 🎉 Icon generation process complete!
echo 📁 Check the 'icons' folder for your extension icons.
echo.

REM Check if PNG files were created
if exist "icons\icon16.png" (
    echo ✅ PNG icons were created successfully
    echo 🚀 Your extension is ready to load in Chrome!
) else (
    echo 📝 SVG icons were created (PNG conversion needed)
    echo 💡 Convert SVGs to PNGs using:
    echo    - Online: https://cloudconvert.com/svg-to-png
    echo    - Or try: npm install canvas (may require build tools)
)

echo.
echo 📋 Next Steps:
echo    1. Load extension in Chrome (chrome://extensions/)
echo    2. Enable Developer mode
echo    3. Click "Load unpacked" and select this folder
echo    4. Configure your Notion integration in the popup
echo.
pause