import http from 'node:http';
import express from 'express';
import path from 'node:path';
import { createExpressApp } from './server/app.ts';

async function startServer() {
  const app = createExpressApp();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ws: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });

    // Vite 8 injects /@vite/client even when server.hmr=false; skip WebSocket connect when DISABLE_HMR=true
    if (hmrDisabled) {
      app.get('/@vite/client', async (req, res, next) => {
        try {
          const transformed = await vite.transformRequest(req.originalUrl);
          if (!transformed) {
            next();
            return;
          }
          const patched = transformed.code.replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* HMR WebSocket disabled via DISABLE_HMR=true */'
          );
          res
            .status(200)
            .type('application/javascript')
            .set('Cache-Control', 'no-cache')
            .send(patched);
        } catch (err) {
          next(err);
        }
      });
    }

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Trendy Unisex Salon Management System listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
