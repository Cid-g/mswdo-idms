'use strict';

const { createSyncRequestHandler, writeJson } = require('./syncHandler');

const HEALTH_PATH = '/healthz';

function createVerificationRequestHandler(options) {
  const syncHandler = createSyncRequestHandler(options);

  return async function verificationRequestHandler(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, 'http://verification.internal');
    } catch {
      writeJson(res, 400, { error: { code: 'INVALID_REQUEST_TARGET', message: 'Request target is invalid.' } });
      return;
    }

    if (requestUrl.pathname === HEALTH_PATH && !requestUrl.search) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        writeJson(
          res,
          405,
          { error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and HEAD are accepted.' } },
          { Allow: 'GET, HEAD' },
        );
        return;
      }

      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Cache-Control': 'no-store, max-age=0',
          'Content-Length': '0',
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end();
        return;
      }

      writeJson(res, 200, { status: 'ok' });
      return;
    }

    await syncHandler(req, res);
  };
}

module.exports = {
  HEALTH_PATH,
  createVerificationRequestHandler,
};
