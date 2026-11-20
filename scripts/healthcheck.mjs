import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const checkHealth = (port = 8080) => new Promise(resolve => {
  const request = http.get({hostname: '127.0.0.1', port, path: '/healthz', timeout: 3000}, response => {
    response.resume();
    resolve(response.statusCode === 204 ? 0 : 1);
  });
  request.on('timeout', () => request.destroy(new Error('timeout')));
  request.on('error', () => resolve(1));
});

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await checkHealth();
}
