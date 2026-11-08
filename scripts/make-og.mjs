// Regenerates public/og.png (1200x630 social preview) from the app screenshot.
// Run: node scripts/make-og.mjs
import sharp from 'sharp';

const W = 1200;
const H = 630;
const bg = '#111317';

const text = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(64 78) scale(0.22)">
    <path d="M58 60 L128 190 L198 60" fill="none" stroke="#F4F7FA" stroke-width="38" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="128" cy="92" r="19" fill="#2DD4BF"/>
  </g>
  <text x="64" y="196" font-family="IBM Plex Sans, DejaVu Sans, sans-serif" font-size="46" font-weight="600" letter-spacing="-1" fill="#e6e8ec">One window for</text>
  <text x="64" y="250" font-family="IBM Plex Sans, DejaVu Sans, sans-serif" font-size="46" font-weight="600" letter-spacing="-1" fill="#9aa1ad">all your local</text>
  <text x="64" y="304" font-family="IBM Plex Sans, DejaVu Sans, sans-serif" font-size="46" font-weight="600" letter-spacing="-1" fill="#9aa1ad">dev commands.</text>
  <text x="64" y="560" font-family="IBM Plex Mono, DejaVu Sans Mono, monospace" font-size="20" fill="#626976">Linux x64 · local-only · MIT</text>
</svg>`);

const shot = await sharp('src/assets/screenshots/projects-and-output.png')
  .resize(820)
  .extend({ top: 1, bottom: 1, left: 1, right: 1, background: '#262a33' })
  .toBuffer();

await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
  .composite([
    { input: shot, left: 600, top: 70 },
    { input: text, left: 0, top: 0 },
  ])
  .png()
  .toFile('public/og.png');

console.log('public/og.png written');
