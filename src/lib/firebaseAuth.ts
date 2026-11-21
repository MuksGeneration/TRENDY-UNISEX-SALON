import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User as FirebaseUser,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

const provider = new GoogleAuthProvider();
for (const scope of WORKSPACE_SCOPES) {
  provider.addScope(scope);
}

// Strictly in-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedGoogleUser: FirebaseUser | null = null;

export function initGoogleWorkspaceAuth(
  onConnected?: (user: FirebaseUser, token: string) => void,
  onDisconnected?: () => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (user && cachedAccessToken) {
      cachedGoogleUser = user;
      onConnected?.(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      cachedGoogleUser = null;
      onDisconnected?.();
    }
  });
}

export async function connectGoogleWorkspace(): Promise<{
  user: FirebaseUser;
  accessToken: string;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google sign-in completed, but no Workspace access token was returned.');
    }
    cachedAccessToken = credential.accessToken;
    cachedGoogleUser = result.user;
    return { user: result.user, accessToken: credential.accessToken };
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        `Google Sign-In popup is blocked on "${host}" because it is not listed under Firebase Console → Authentication → Settings → Authorized domains. Either add "${host}" there, or use the Apps Script Web App Bridge in Settings → Google Workspace (no Google OAuth popup needed).`
      );
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('Your browser blocked the Google Sign-In popup. Allow popups for this site and try again.');
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Google sign-in popup was closed before completing.');
    }
    if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
      throw new Error(
        'Google OAuth sign-in is not enabled in Firebase Authentication. Use the Apps Script Web App Bridge in Settings → Google Workspace instead.'
      );
    }
    throw err;
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

export function getGoogleUser(): FirebaseUser | null {
  return cachedGoogleUser;
}

export async function disconnectGoogleWorkspace(): Promise<void> {
  await auth.signOut();
  cachedAccessToken = null;
  cachedGoogleUser = null;
}
