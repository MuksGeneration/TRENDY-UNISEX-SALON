import express from 'express';
import dotenv from 'dotenv';
import { createApiRouter } from './routes.ts';
import {
  ensureCloudDbHydrated,
  flushCloudDbSync,
  getLastCloudSyncError,
  IS_SERVERLESS,
  isCloudHydratedOnce,
  isCloudSyncConfigured,
  isDbDirtyForCloud,
  readDb,
  type CloudSyncResult,
} from './db.ts';
import {
  getRelevantSheetTabsForApiPath,
  getServerGoogleCredentialsStatus,
} from './workspaceService.ts';

dotenv.config();

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function attachCloudSyncMetadata(body: unknown, syncResult: CloudSyncResult): unknown {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return {
      ...(body as Record<string, unknown>),
      cloudSync: syncResult,
    };
  }
  return body;
}

export function createExpressApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.set('etag', false);
  app.use(express.json({ limit: '15mb' }));

  // Ensure initial DB exists in memory / local or /tmp cache
  readDb();

  // Cold-start hydration & automatic write-through sync to Google Sheets
  app.use('/api', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    try {
      await ensureCloudDbHydrated();
    } catch (err) {
      console.warn('Cloud DB hydration skipped:', err instanceof Error ? err.message : err);
    }

    if (
      MUTATING_METHODS.has(req.method) &&
      !req.path.startsWith('/workspace/sheets/')
    ) {
      const requestGoogleToken = req.headers['x-google-token']?.toString()?.trim();
      const onlyTabs = getRelevantSheetTabsForApiPath(req.path);
      const isAuthLifecycle = req.path.startsWith('/auth/');
      const origJson = res.json.bind(res);
      let flushed = false;

      res.json = ((body: unknown) => {
        if (!flushed && isDbDirtyForCloud()) {
          flushed = true;
          const cloudConfigured = isCloudSyncConfigured();
          // On Vercel/serverless or for all business mutations (POS, appointments, CRM, HR, etc.),
          // await Google Sheets sync so a subsequent page refresh reads the saved record cleanly.
          // Auth login/logout on persistent Node servers syncs in background to keep sign-in snappy.
          const shouldAwaitSync =
            IS_SERVERLESS ||
            process.env.AUTO_SYNC_GOOGLE_SHEETS === 'true' ||
            (cloudConfigured && !isAuthLifecycle);

          if (shouldAwaitSync && (cloudConfigured || Boolean(requestGoogleToken))) {
            void flushCloudDbSync(requestGoogleToken, onlyTabs)
              .then((syncResult) => {
                if (syncResult.configured) {
                  res.setHeader(
                    'X-Cloud-Sync-Status',
                    syncResult.synced ? 'synced' : 'failed'
                  );
                }
                origJson(attachCloudSyncMetadata(body, syncResult));
              })
              .catch((err) => {
                const fallback: CloudSyncResult = {
                  synced: false,
                  configured: cloudConfigured,
                  error: err instanceof Error ? err.message : 'Cloud sync failed.',
                };
                res.setHeader('X-Cloud-Sync-Status', 'failed');
                origJson(attachCloudSyncMetadata(body, fallback));
              });
            return res;
          }
          void flushCloudDbSync(requestGoogleToken, onlyTabs);
        }
        return origJson(body);
      }) as express.Response['json'];
    }

    next();
  });

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    const db = readDb();
    const serverCreds = getServerGoogleCredentialsStatus(db.settings.googleAppsScriptUrl);
    res.json({
      status: 'ok',
      service: 'Trendy Unisex Salon Management System',
      platform: process.env.VERCEL ? 'vercel' : IS_SERVERLESS ? 'serverless' : 'node',
      sheetsDatabaseLinked: Boolean(
        db.settings.googleAppsScriptUrl ||
          process.env.GOOGLE_APPS_SCRIPT_URL?.trim() ||
          db.settings.googleSpreadsheetId ||
          process.env.GOOGLE_SPREADSHEET_ID?.trim()
      ),
      driveStorageLinked: Boolean(
        db.settings.googleAppsScriptUrl ||
          process.env.GOOGLE_APPS_SCRIPT_URL?.trim() ||
          db.settings.googleDriveFolderId ||
          process.env.GOOGLE_DRIVE_FOLDER_ID?.trim()
      ),
      serverGoogleCredentials: serverCreds.mode,
      cloudHydratedOnce: isCloudHydratedOnce(),
      pendingCloudSync: isDbDirtyForCloud(),
      lastSheetsSyncAt: db.settings.lastSheetsSyncAt || null,
      lastCloudSyncError: getLastCloudSyncError(),
    });
  });

  const resolvePublicOrigin = (req: express.Request) => {
    const envUrl = process.env.APP_URL?.trim();
    if (envUrl) return envUrl.replace(/\/+$/, '');
    const rawProto =
      req.headers['x-forwarded-proto']?.toString().split(',')[0].trim() || req.protocol || 'https';
    const proto = rawProto === 'http' ? 'http' : 'https';
    const rawHost =
      req.headers['x-forwarded-host']?.toString().split(',')[0].trim() || req.get('host') || '';
    const safeHost = /^[a-zA-Z0-9.-]+(:\d+)?$/.test(rawHost) ? rawHost : '';
    return safeHost ? `${proto}://${safeHost}` : 'https://www.trendyunisexsalon.online';
  };

  app.get('/robots.txt', (req, res) => {
    const origin = resolvePublicOrigin(req);
    res
      .status(200)
      .type('text/plain; charset=utf-8')
      .send(
        `User-agent: *\nAllow: /\nAllow: /?view=book\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`
      );
  });

  app.get('/sitemap.xml', (req, res) => {
    const origin = resolvePublicOrigin(req);
    res
      .status(200)
      .type('application/xml; charset=utf-8')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          `  <url>\n    <loc>${origin}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n` +
          `  <url>\n    <loc>${origin}/?view=book</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n` +
          `</urlset>\n`
      );
  });

  // Mount API routes
  app.use('/api', createApiRouter());

  return app;
}
