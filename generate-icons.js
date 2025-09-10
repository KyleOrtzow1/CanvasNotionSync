// generate-icons.js - Simple Icon Generator for Canvas-Notion Sync Extension
// Run with: node generate-icons.js

const fs = require('fs');
const path = require('path');

// Simple function to create a PNG programmatically using Canvas API (if available) or fallback
function generateIcon(size, outputPath) {
  const { createCanvas } = require('canvas');
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Background with rounded corners effect
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(0, 0, size, size);
  
  // Create assignment lines
  ctx.fillStyle = 'white';
  const lineHeight = size * 0.08;
  const lineSpacing = size * 0.15;
  const startY = size * 0.25;
  
  // Three assignment lines
  ctx.fillRect(size * 0.2, startY, size * 0.6, lineHeight);
  ctx.fillRect(size * 0.2, startY + lineSpacing, size * 0.6, lineHeight);
  ctx.fillRect(size * 0.2, startY + lineSpacing * 2, size * 0.45, lineHeight);
  
  // Checkmark circle
  ctx.fillStyle = '#4caf50';
  ctx.beginPath();
  ctx.arc(size * 0.75, size * 0.7, size * 0.12, 0, 2 * Math.PI);
  ctx.fill();
  
  // Checkmark
  ctx.strokeStyle = 'white';
  ctx.lineWidth = size * 0.03;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.69, size * 0.7);
  ctx.lineTo(size * 0.73, size * 0.74);
  ctx.lineTo(size * 0.81, size * 0.66);
  ctx.stroke();
  
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
  console.log(`✅ Created: ${outputPath}`);
}

// Fallback method if canvas is not available
function generateFallbackIcon(size, outputPath) {
  console.log(`📝 Creating fallback SVG for ${size}x${size}...`);
  
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="#2e7d32"/>
    <rect x="${size * 0.2}" y="${size * 0.25}" width="${size * 0.6}" height="${size * 0.08}" fill="white" rx="2"/>
    <rect x="${size * 0.2}" y="${size * 0.4}" width="${size * 0.6}" height="${size * 0.08}" fill="white" rx="2"/>
    <rect x="${size * 0.2}" y="${size * 0.55}" width="${size * 0.45}" height="${size * 0.08}" fill="white" rx="2"/>
    <circle cx="${size * 0.75}" cy="${size * 0.7}" r="${size * 0.12}" fill="#4caf50"/>
    <path d="M ${size * 0.69} ${size * 0.7} L ${size * 0.73} ${size * 0.74} L ${size * 0.81} ${size * 0.66}" 
          stroke="white" stroke-width="${size * 0.03}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  
  const svgPath = outputPath.replace('.png', '.svg');
  fs.writeFileSync(svgPath, svg);
  console.log(`✅ Created SVG: ${svgPath}`);
  console.log(`   Convert to PNG at: https://cloudconvert.com/svg-to-png`);
}

// Main execution
function main() {
  console.log('🎨 Generating icons for Canvas-Notion Sync Extension...\n');
  
  // Ensure icons directory exists
  const iconsDir = path.join(__dirname, 'icons');
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir);
    console.log('📁 Created icons directory');
  }
  
  const sizes = [16, 48, 128];
  
  try {
    // Try to use canvas library for better icons
    require('canvas');
    console.log('✅ Canvas library found - generating high-quality PNG icons\n');
    
    sizes.forEach(size => {
      const outputPath = path.join(iconsDir, `icon${size}.png`);
      generateIcon(size, outputPath);
    });
    
  } catch (error) {
    console.log('📦 Canvas library not found.');
    console.log('💡 For PNG generation, run: npm install canvas');
    console.log('🔄 Creating SVG files instead (can be converted to PNG)...\n');
    
    sizes.forEach(size => {
      const outputPath = path.join(iconsDir, `icon${size}.png`);
      generateFallbackIcon(size, outputPath);
    });
    
    console.log('\n📋 Next steps to get PNG files:');
    console.log('   Option 1: Install canvas library');
    console.log('     npm install canvas');
    console.log('     node generate-icons.js');
    console.log('   Option 2: Convert SVGs online');
    console.log('     Upload SVGs to https://cloudconvert.com/svg-to-png');
    console.log('   Option 3: Use command line tool');
    console.log('     npm install -g svg2png-cli');
    console.log('     svg2png icons/icon16.svg icons/icon16.png');
  }
  
  console.log('\n🎉 Icon generation complete!');
}

// Create package.json if it doesn't exist
function createPackageJson() {
  const packageJson = {
    "name": "canvas-notion-sync",
    "version": "1.0.0",
    "description": "Canvas-Notion Assignment Sync Extension",
    "scripts": {
      "generate-icons": "node generate-icons.js"
    },
    "optionalDependencies": {
      "canvas": "^2.11.2"
    },
    "keywords": ["canvas", "notion", "chrome-extension"],
    "license": "MIT"
  };
  
  if (!fs.existsSync('package.json')) {
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
    console.log('📦 Created package.json');
  }
}

// Run the script
if (require.main === module) {
  createPackageJson();
  main();
}

module.exports = { generateIcon, generateFallbackIcon };