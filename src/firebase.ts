import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

// Validate connection to Firestore on boot as required by guidelines
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

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

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validation constants synchronized verbatim with firebase-blueprint.json & firestore.rules
export const RECORD_CATEGORIES = [
  'Inventario',
  'Clientes',
  'Finanzas',
  'Proyectos',
  'Operaciones',
] as const;

export const RECORD_STATUSES = [
  'Activo',
  'En Revision',
  'Completado',
  'Archivado',
] as const;

export const RECORD_PRIORITIES = ['Alta', 'Media', 'Baja'] as const;

export type RecordCategory = (typeof RECORD_CATEGORIES)[number];
export type RecordStatus = (typeof RECORD_STATUSES)[number];
export type RecordPriority = (typeof RECORD_PRIORITIES)[number];

export const VALIDATION_LIMITS = {
  TITLE_MIN: 1,
  TITLE_MAX: 120,
  CODE_MIN: 1,
  CODE_MAX: 32,
  CODE_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  NOTES_MAX: 500,
  AMOUNT_MIN: -1000000000,
  AMOUNT_MAX: 1000000000,
  ID_MAX: 128,
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
};

export interface RecordItemInput {
  title: string;
  code: string;
  category: RecordCategory;
  status: RecordStatus;
  priority: RecordPriority;
  amount: number;
  notes: string;
}

export function sanitizeAndValidateRecordInput(
  raw: RecordItemInput
): { valid: boolean; error?: string; sanitized?: RecordItemInput } {
  const title = raw.title.trim().slice(0, VALIDATION_LIMITS.TITLE_MAX);
  const code = raw.code
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .toUpperCase()
    .slice(0, VALIDATION_LIMITS.CODE_MAX);
  const notes = (raw.notes || '').trim().slice(0, VALIDATION_LIMITS.NOTES_MAX);
  const amount = Number(raw.amount);

  if (title.length < VALIDATION_LIMITS.TITLE_MIN) {
    return { valid: false, error: 'El título es obligatorio (1 a 120 caracteres).' };
  }
  if (
    code.length < VALIDATION_LIMITS.CODE_MIN ||
    !VALIDATION_LIMITS.CODE_PATTERN.test(code)
  ) {
    return {
      valid: false,
      error:
        'El código debe contener entre 1 y 32 caracteres alfanuméricos, guiones o guiones bajos.',
    };
  }
  if (!RECORD_CATEGORIES.includes(raw.category)) {
    return { valid: false, error: 'Categoría inválida.' };
  }
  if (!RECORD_STATUSES.includes(raw.status)) {
    return { valid: false, error: 'Estado inválido.' };
  }
  if (!RECORD_PRIORITIES.includes(raw.priority)) {
    return { valid: false, error: 'Prioridad inválida.' };
  }
  if (
    Number.isNaN(amount) ||
    amount < VALIDATION_LIMITS.AMOUNT_MIN ||
    amount > VALIDATION_LIMITS.AMOUNT_MAX
  ) {
    return { valid: false, error: 'El monto numérico está fuera del rango permitido.' };
  }

  return {
    valid: true,
    sanitized: {
      title,
      code,
      category: raw.category,
      status: raw.status,
      priority: raw.priority,
      amount,
      notes,
    },
  };
}
