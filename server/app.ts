import express from 'express';
import dotenv from 'dotenv';
import { createApiRouter } from './routes.ts';
import {
  ensureCloudDbHydrated,
  flushCloudDbSync,
  IS_SERVERLESS,
  isDbDirtyForCloud,
  readDb,
} from './db.ts';
import { getServerGoogleCredentialsStatus } from './workspaceService.ts';

dotenv.config();

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function createExpressApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '15mb' }));

  // Ensure initial DB exists in memory / local or /tmp cache
  readDb();

  // Cold-start hydration & automatic write-through sync to Google Sheets
  app.use('/api', async (req, res, next) => {
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
      const origJson = res.json.bind(res);
      let flushed = false;

      res.json = ((body: unknown) => {
        if (!flushed && isDbDirtyForCloud()) {
          flushed = true;
          if (IS_SERVERLESS || process.env.AUTO_SYNC_GOOGLE_SHEETS === 'true') {
            void flushCloudDbSync(requestGoogleToken).finally(() => {
              origJson(body);
            });
            return res;
          }
          void flushCloudDbSync(requestGoogleToken);
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
    });
  });

  // Mount API routes
  app.use('/api', createApiRouter());

  return app;
}
