'use strict';

// Minimal @napi-rs/canvas stub so tests that load app.js don't crash
// due to the native Windows binding not being available in this environment.
// ID-generation functionality is not exercised in these integration tests.

const canvasStub = {
  getContext: () => ({
    drawImage: () => {},
    fillRect: () => {},
    fillText: () => {},
    measureText: () => ({ width: 0 }),
    strokeRect: () => {},
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setTransform: () => {},
    createPattern: () => ({}),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  }),
  toBuffer: () => Promise.resolve(Buffer.alloc(0)),
  width: 800,
  height: 600,
};

module.exports = {
  createCanvas: () => canvasStub,
  loadImage: () => Promise.resolve(canvasStub),
};
