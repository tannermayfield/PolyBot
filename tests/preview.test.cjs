'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPreviewServer } = require('../scripts/preview.cjs');
test('preview serves app assets and never serves private/configuration paths', async () => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(origin + '/popup.html');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    for (const pathname of ['/.git/config', '/server/.env', '/.worktrees/studio-ui/studio.html', '/package.json', '/%2e%2e%5c.env']) {
      assert.equal((await fetch(origin + pathname)).status, 404);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
