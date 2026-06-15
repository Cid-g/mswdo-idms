'use strict';

// Minimal sharp stub so tests that load app.js (which pulls in imageProcessing.js)
// don't crash due to the native sharp binding not loading on this Windows environment.
// Image-processing endpoints are not exercised in these integration tests.

function sharpStub() {
  const chain = {
    flatten: () => chain,
    png: () => chain,
    jpeg: () => chain,
    resize: () => chain,
    grayscale: () => chain,
    normalise: () => chain,
    threshold: () => chain,
    raw: () => chain,
  };
  // Allow toBuffer({ resolveWithObject: true })
  chain.toBuffer = (opts) => {
    if (opts && opts.resolveWithObject) {
      return Promise.resolve({ data: Buffer.alloc(0), info: { width: 1, height: 1, channels: 4 } });
    }
    return Promise.resolve(Buffer.alloc(0));
  };
  return chain;
}

module.exports = sharpStub;
