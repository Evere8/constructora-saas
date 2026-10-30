import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { initialWorkspace } from './fixture';

// Isolated HTTP contract double; real database contracts are tested in
// backend/tests/test_release_flows.py. Never included in the production build.
let workspace: Record<string, any> = initialWorkspace();
export default defineConfig({
  configFile: false,
  plugins: [react(), {
    name: 'qa-api',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__qa/')) return next();
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
          const route = req.url.split('?')[0];
          let result: unknown = workspace;
          if (route === '/__qa/reset') workspace = initialWorkspace();
          if (route === '/__qa/annotations' && req.method === 'POST') {
            result = workspace.annotations.find((mark: any) => mark.id === body.client_id);
            if (!result) { result = { ...body, id: body.client_id }; workspace.annotations.push(result); }
          }
          if (route.startsWith('/__qa/annotations/') && req.method === 'DELETE') workspace.annotations = workspace.annotations.filter((mark: any) => mark.id !== route.split('/').pop());
          if (route === '/__qa/points' && req.method === 'POST') {
            result = { ...body, id: 'point-qa', label: null, note_text: null, color_hex: '#ef4444', status: 'pending', diameter: 0.026, checklist_json: workspace.colors[0].checklist_json };
            workspace.points.push(result);
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch { res.statusCode = 500; res.end('{}'); }
      });
    },
  }],
  resolve: { alias: [
    { find: '@/auth/useMe', replacement: path.resolve('e2e/auth.ts') },
    { find: '@/auth/useCan', replacement: path.resolve('e2e/auth.ts') },
    { find: '@/lib/api/rubros', replacement: path.resolve('e2e/rubros.ts') },
    { find: '@/lib/api/modules', replacement: path.resolve('e2e/modules.ts') },
    { find: '@', replacement: path.resolve('src') },
  ] },
  optimizeDeps: { entries: ['e2e/index.html'] },
  server: { host: '127.0.0.1', port: 4175, strictPort: true },
});
