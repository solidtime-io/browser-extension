import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const iconDir = join(publicDir, 'icon');

const sizes = [16, 32, 48, 96, 128];

async function generateIcons() {
  try {
    // Create icon directory
    await mkdir(iconDir, { recursive: true });

    // Generate PNG icons from SVG
    for (const size of sizes) {
      await sharp(join(publicDir, 'icon.svg'))
        .resize(size, size)
        .png()
        .toFile(join(iconDir, `${size}.png`));

      console.log(`✓ Generated ${size}x${size} icon`);
    }

    console.log('\n✅ All icons generated successfully!');
  } catch (error) {
    console.error('❌ Error generating icons:', error);
    process.exit(1);
  }
}

generateIcons();
