import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { setAuthToken, clearAuthToken } from './api';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCTfWyOO0OwIQKjm7nqs0czTz37lDlUT2A',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'guardian-fbadd.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'guardian-fbadd',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'guardian-fbadd.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '813482800288',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:813482800288:web:cc6d6dd3d1ec6d6cc205c5',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export function watchAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      const token = await user.getIdToken();
      setAuthToken(token);
    } else {
      clearAuthToken();
    }
    callback(user);
  });
}

export async function loginWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  const token = await result.user.getIdToken();
  setAuthToken(token);
  return result.user;
}

export async function loginWithEmail(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  const token = await result.user.getIdToken();
  setAuthToken(token);
  return result.user;
}

export async function logout() {
  clearAuthToken();
  await signOut(auth);
}

export async function refreshAuthToken() {
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken(true);
  setAuthToken(token);
  return token;
}
