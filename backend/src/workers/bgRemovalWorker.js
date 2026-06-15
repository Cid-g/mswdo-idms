const sharp = require('sharp');

async function run() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = Buffer.concat(chunks);

  const { removeBackground } = await import('@imgly/background-removal-node');
  const blob   = new Blob([input], { type: 'image/png' });
  const result = await removeBackground(blob);
  const transparent = Buffer.from(await result.arrayBuffer());

  const output = await sharp(transparent)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();

  process.stdout.write(output);
}

run().catch(() => process.exit(1));
