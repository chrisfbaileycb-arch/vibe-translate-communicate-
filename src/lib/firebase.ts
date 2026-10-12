import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import type { IntentModel, TargetId } from './types.ts';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

/* CRITICAL: The app will break without passing firestoreDatabaseId */
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const currentUser = auth.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline, check connection.');
      return false;
    }
    // Connection test document might not exist, but network reachability is verified
    return true;
  }
}

export async function loginWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(result.user);
  return result.user;
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

export async function ensureUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const now = new Date().toISOString();
    await setDoc(
      userRef,
      {
        uid: user.uid,
        email: user.email || 'user@example.com',
        displayName: user.displayName || 'Translator User',
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface SavedTranslationRecord {
  id: string;
  userId: string;
  label: string;
  kind: string;
  sourceText?: string;
  target?: TargetId;
  modelData: string;
  createdAt: string;
  updatedAt: string;
}

export async function saveTranslationWorkflow(
  userId: string,
  model: IntentModel,
  target: TargetId,
): Promise<SavedTranslationRecord> {
  const translationId = model.id || `trans_${Date.now()}`;
  const path = `users/${userId}/translations/${translationId}`;
  const now = new Date().toISOString();

  const record: SavedTranslationRecord = {
    id: translationId,
    userId,
    label: model.label || 'Custom model',
    kind: model.kind,
    sourceText: model.sourceText || '',
    target,
    modelData: JSON.stringify(model),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const docRef = doc(db, 'users', userId, 'translations', translationId);
    await setDoc(docRef, record);
    return record;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteTranslationWorkflow(userId: string, translationId: string): Promise<void> {
  const path = `users/${userId}/translations/${translationId}`;
  try {
    const docRef = doc(db, 'users', userId, 'translations', translationId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToUserTranslations(
  userId: string,
  onData: (translations: SavedTranslationRecord[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const path = `users/${userId}/translations`;
  const colRef = collection(db, 'users', userId, 'translations');
  const q = query(colRef, orderBy('updatedAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SavedTranslationRecord[] = [];
      snapshot.forEach((d) => items.push(d.data() as SavedTranslationRecord));
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

export { onAuthStateChanged };
