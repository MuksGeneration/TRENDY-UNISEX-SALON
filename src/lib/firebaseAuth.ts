import type { Auth, GoogleAuthProvider as GoogleAuthProviderType, User as FirebaseUser } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

// Strictly in-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedGoogleUser: FirebaseUser | null = null;

interface FirebaseAuthBundle {
  auth: Auth;
  provider: GoogleAuthProviderType;
  signInWithPopup: typeof import('firebase/auth').signInWithPopup;
  GoogleAuthProvider: typeof import('firebase/auth').GoogleAuthProvider;
  onAuthStateChanged: typeof import('firebase/auth').onAuthStateChanged;
}

let firebaseBundlePromise: Promise<FirebaseAuthBundle> | null = null;

async function getFirebaseAuthBundle(): Promise<FirebaseAuthBundle> {
  if (!firebaseBundlePromise) {
    firebaseBundlePromise = (async () => {
      const [{ initializeApp, getApps }, authMod] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
      ]);
      const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
      const auth = authMod.getAuth(app);
      const provider = new authMod.GoogleAuthProvider();
      for (const scope of WORKSPACE_SCOPES) {
        provider.addScope(scope);
      }
      return {
        auth,
        provider,
        signInWithPopup: authMod.signInWithPopup,
        GoogleAuthProvider: authMod.GoogleAuthProvider,
        onAuthStateChanged: authMod.onAuthStateChanged,
      };
    })();
  }
  return firebaseBundlePromise;
}

export function initGoogleWorkspaceAuth(
  onConnected?: (user: FirebaseUser, token: string) => void,
  onDisconnected?: () => void
) {
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;

  if (firebaseBundlePromise) {
    void getFirebaseAuthBundle()
      .then(({ auth, onAuthStateChanged }) => {
        if (cancelled) return;
        unsubscribe = onAuthStateChanged(auth, (user) => {
          if (user && cachedAccessToken) {
            cachedGoogleUser = user;
            onConnected?.(user, cachedAccessToken);
          } else if (!isSigningIn) {
            cachedAccessToken = null;
            cachedGoogleUser = null;
            onDisconnected?.();
          }
        });
      })
      .catch(() => {
        // Non-fatal if auth listener cannot attach
      });
  }

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

export async function connectGoogleWorkspace(): Promise<{
  user: FirebaseUser;
  accessToken: string;
}> {
  try {
    isSigningIn = true;
    const { auth, provider, signInWithPopup, GoogleAuthProvider } = await getFirebaseAuthBundle();
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
  if (firebaseBundlePromise) {
    try {
      const { auth } = await getFirebaseAuthBundle();
      await auth.signOut();
    } catch {
      // Ignore sign-out errors if Firebase was not initialized
    }
  }
  cachedAccessToken = null;
  cachedGoogleUser = null;
}
