const sharp = require('sharp');
const path = require('path');

const input = path.resolve(__dirname, 'public/logo.png');

sharp(input)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
  .then(({ data, info }) => {
    const { width, height, channels } = info;
    for (let i = 0; i < width * height; i++) {
      const idx = i * channels;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // near-white -> fully transparent; scale alpha down as pixel approaches white
      const brightness = (r + g + b) / 3;
      if (brightness > 250) {
        data[idx + 3] = 0;
      } else if (brightness > 200) {
        // smooth falloff for anti-aliased edge pixels
        const alpha = Math.round(((250 - brightness) / 50) * 255);
        data[idx + 3] = alpha;
      }
    }
    return sharp(data, { raw: { width, height, channels } })
      .png()
      .toFile(input);
  })
  .then(() => console.log('done'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
