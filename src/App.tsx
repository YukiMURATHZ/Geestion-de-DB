/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  Database,
  Plus,
  Search,
  Download,
  Trash2,
  Edit3,
  Code2,
  BarChart3,
  Layers,
  LogIn,
  LogOut,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Archive,
  RefreshCw,
  Copy,
  Check,
  X,
  FileJson,
  ShieldCheck,
  ArrowUpDown,
  FolderKanban,
  Users,
  Wallet,
  Package,
  Settings2,
} from 'lucide-react';
import {
  db,
  auth,
  googleProvider,
  OperationType,
  handleFirestoreError,
  RECORD_CATEGORIES,
  RECORD_STATUSES,
  RECORD_PRIORITIES,
  RecordCategory,
  RecordStatus,
  RecordPriority,
  RecordItemInput,
  sanitizeAndValidateRecordInput,
  VALIDATION_LIMITS,
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
} from './firebase';

export interface DatabaseRecord extends RecordItemInput {
  id: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

const DEMO_SEED_RECORDS: RecordItemInput[] = [
  {
    code: 'INV-1042',
    title: 'Cluster de Servidores NVMe Gen5 (Rack B4)',
    category: 'Inventario',
    status: 'Activo',
    priority: 'Alta',
    amount: 18450.0,
    notes: 'Almacenamiento primario de baja latencia para nodos de producción.',
  },
  {
    code: 'CLI-2089',
    title: 'Contrato Anual Enterprise — Grupo Logístico Andino',
    category: 'Clientes',
    status: 'Activo',
    priority: 'Alta',
    amount: 42000.0,
    notes: 'Renovación de licencias multi-región con soporte 24/7 incluido.',
  },
  {
    code: 'FIN-3015',
    title: 'Liquidación Trimestral Infraestructura Cloud Q3',
    category: 'Finanzas',
    status: 'Completado',
    priority: 'Media',
    amount: 9620.5,
    notes: 'Auditoría contable conciliada y aprobada por dirección financiera.',
  },
  {
    code: 'PRJ-4012',
    title: 'Migración de Esquema Transaccional v2.4',
    category: 'Proyectos',
    status: 'En Revision',
    priority: 'Alta',
    amount: 14800.0,
    notes: 'Pruebas de carga y validación de reglas de seguridad completadas al 90%.',
  },
  {
    code: 'OPS-5008',
    title: 'Mantenimiento Preventivo Enlaces de Fibra Óptica',
    category: 'Operaciones',
    status: 'Activo',
    priority: 'Media',
    amount: 3450.0,
    notes: 'Ventana de mantenimiento programada para el domingo 02:00 UTC.',
  },
  {
    code: 'INV-1098',
    title: 'Lote de Terminales Escáner Industrial RFID',
    category: 'Inventario',
    status: 'Completado',
    priority: 'Baja',
    amount: 6190.0,
    notes: '24 unidades distribuidas en el almacén central de distribución.',
  },
];

function generateSafeId(prefix = 'rec'): string {
  const randomPart = Math.random().toString(36).substring(2, 10);
  const timePart = Date.now().toString(36);
  return `${prefix}_${timePart}_${randomPart}`;
}

function parseFirestoreTimestamp(val: unknown): Date {
  if (val instanceof Timestamp) {
    return val.toDate();
  }
  if (val && typeof val === 'object' && 'seconds' in val) {
    return new Date((val as { seconds: number }).seconds * 1000);
  }
  if (val instanceof Date) {
    return val;
  }
  return new Date();
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Cloud Firestore records (when authenticated)
  const [cloudRecords, setCloudRecords] = useState<DatabaseRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  // Local preview records (when not yet signed in, so the app is immediately functional)
  const [localPreviewRecords, setLocalPreviewRecords] = useState<DatabaseRecord[]>(() =>
    DEMO_SEED_RECORDS.map((item, idx) => ({
      ...item,
      id: `demo_record_${idx + 1}`,
      ownerId: 'modo_vista_previa',
      createdAt: new Date(Date.now() - (6 - idx) * 86400000),
      updatedAt: new Date(Date.now() - (6 - idx) * 3600000),
    }))
  );

  // Navigation & View state
  const [activeView, setActiveView] = useState<'table' | 'analytics' | 'schema'>('table');
  const [selectedCategory, setSelectedCategory] = useState<RecordCategory | 'Todas'>('Todas');
  const [selectedStatus, setSelectedStatus] = useState<RecordStatus | 'Todos'>('Todos');
  const [selectedPriority, setSelectedPriority] = useState<RecordPriority | 'Todas'>('Todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updatedAt' | 'amount' | 'code' | 'title'>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Modals & Drawers
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DatabaseRecord | null>(null);
  const [inspectedRecord, setInspectedRecord] = useState<DatabaseRecord | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<RecordItemInput>({
    title: '',
    code: 'REG-1001',
    category: 'Inventario',
    status: 'Activo',
    priority: 'Media',
    amount: 0,
    notes: '',
  });

  // Track Firebase Authentication state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      setAuthError(null);
    });
    return () => unsubscribe();
  }, []);

  // Attach real-time Firestore listener when authenticated
  useEffect(() => {
    if (!authReady || !user) {
      setCloudRecords([]);
      setLoadingRecords(false);
      return;
    }

    setLoadingRecords(true);
    setDbError(null);
    const recordsPath = 'records';
    const q = query(
      collection(db, recordsPath),
      where('ownerId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: DatabaseRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            title: String(data.title || ''),
            code: String(data.code || ''),
            category: (data.category as RecordCategory) || 'Inventario',
            status: (data.status as RecordStatus) || 'Activo',
            priority: (data.priority as RecordPriority) || 'Media',
            amount: Number(data.amount || 0),
            notes: String(data.notes || ''),
            ownerId: String(data.ownerId || user.uid),
            createdAt: parseFirestoreTimestamp(data.createdAt),
            updatedAt: parseFirestoreTimestamp(data.updatedAt),
          };
        });
        setCloudRecords(items);
        setLoadingRecords(false);
      },
      (error) => {
        setLoadingRecords(false);
        setDbError(error.message);
        try {
          handleFirestoreError(error, OperationType.LIST, recordsPath);
        } catch {
          // Error logged in structured format
        }
      }
    );

    return () => unsubscribe();
  }, [authReady, user]);

  // Keep inspected record synced with live updates
  const activeRecords = user ? cloudRecords : localPreviewRecords;

  useEffect(() => {
    if (inspectedRecord) {
      const updated = activeRecords.find((r) => r.id === inspectedRecord.id);
      if (updated) {
        setInspectedRecord(updated);
      } else {
        setInspectedRecord(null);
      }
    }
  }, [activeRecords, inspectedRecord]);

  // Sign in with Google Popup
  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Error al iniciar sesión con Google.';
      setAuthError(msg);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setInspectedRecord(null);
    } catch (error) {
      console.error(error);
    }
  };

  // Open Modal for Creating a Record
  const openCreateModal = () => {
    const nextNumber = 1000 + activeRecords.length + 1;
    const prefix =
      selectedCategory === 'Todas'
        ? 'REG'
        : selectedCategory.slice(0, 3).toUpperCase();
    setEditingRecord(null);
    setFormData({
      title: '',
      code: `${prefix}-${nextNumber}`,
      category: selectedCategory === 'Todas' ? 'Inventario' : selectedCategory,
      status: 'Activo',
      priority: 'Media',
      amount: 0,
      notes: '',
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  // Open Modal for Editing an Existing Record
  const openEditModal = (record: DatabaseRecord) => {
    if (record.status === 'Archivado') {
      return;
    }
    setEditingRecord(record);
    setFormData({
      title: record.title,
      code: record.code,
      category: record.category,
      status: record.status,
      priority: record.priority,
      amount: record.amount,
      notes: record.notes,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  // Create or Update Record
  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const validation = sanitizeAndValidateRecordInput(formData);
    if (!validation.valid || !validation.sanitized) {
      setFormError(validation.error || 'Datos inválidos.');
      return;
    }

    const sanitized = validation.sanitized;

    // If user is not signed in, save to local preview state
    if (!user) {
      const now = new Date();
      if (editingRecord) {
        setLocalPreviewRecords((prev) =>
          prev.map((item) =>
            item.id === editingRecord.id
              ? { ...item, ...sanitized, updatedAt: now }
              : item
          )
        );
      } else {
        const newRec: DatabaseRecord = {
          ...sanitized,
          id: generateSafeId('demo'),
          ownerId: 'modo_vista_previa',
          createdAt: now,
          updatedAt: now,
        };
        setLocalPreviewRecords((prev) => [newRec, ...prev]);
      }
      setIsFormOpen(false);
      return;
    }

    // Authenticated: Persist in Cloud Firestore
    setIsSaving(true);
    try {
      if (editingRecord) {
        const docPath = `records/${editingRecord.id}`;
        try {
          await updateDoc(doc(db, 'records', editingRecord.id), {
            title: sanitized.title,
            code: sanitized.code,
            category: sanitized.category,
            status: sanitized.status,
            priority: sanitized.priority,
            amount: sanitized.amount,
            notes: sanitized.notes,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, docPath);
        }
      } else {
        const newId = generateSafeId('rec');
        const docPath = `records/${newId}`;
        try {
          await setDoc(doc(db, 'records', newId), {
            title: sanitized.title,
            code: sanitized.code,
            category: sanitized.category,
            status: sanitized.status,
            priority: sanitized.priority,
            amount: sanitized.amount,
            notes: sanitized.notes,
            ownerId: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, docPath);
        }
      }
      setIsFormOpen(false);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? 'Error al guardar en Firestore. Verifica tu sesión.'
          : 'Error inesperado.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Quick Status Change
  const handleQuickStatusChange = async (
    record: DatabaseRecord,
    nextStatus: RecordStatus
  ) => {
    if (record.status === 'Archivado' || record.status === nextStatus) {
      return;
    }

    if (!user) {
      setLocalPreviewRecords((prev) =>
        prev.map((r) =>
          r.id === record.id
            ? { ...r, status: nextStatus, updatedAt: new Date() }
            : r
        )
      );
      return;
    }

    const docPath = `records/${record.id}`;
    try {
      await updateDoc(doc(db, 'records', record.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, docPath);
      } catch {
        // Handled
      }
    }
  };

  // Delete Record
  const handleDeleteRecord = async (recordId: string) => {
    if (!user) {
      setLocalPreviewRecords((prev) => prev.filter((r) => r.id !== recordId));
      setDeleteConfirmId(null);
      return;
    }

    const docPath = `records/${recordId}`;
    try {
      await deleteDoc(doc(db, 'records', recordId));
      setDeleteConfirmId(null);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, docPath);
      } catch {
        // Handled
      }
    }
  };

  // Seed Sample Data into Firestore (or reset local preview)
  const handleSeedDemoData = async () => {
    if (!user) {
      setLocalPreviewRecords(
        DEMO_SEED_RECORDS.map((item, idx) => ({
          ...item,
          id: generateSafeId(`demo_${idx}`),
          ownerId: 'modo_vista_previa',
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );
      return;
    }

    setIsSeeding(true);
    setDbError(null);
    try {
      const batch = writeBatch(db);
      for (const sample of DEMO_SEED_RECORDS) {
        const newId = generateSafeId('rec');
        const ref = doc(db, 'records', newId);
        batch.set(ref, {
          ...sample,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'records');
      } catch {
        setDbError('No se pudieron insertar los datos de ejemplo.');
      }
    } finally {
      setIsSeeding(false);
    }
  };

  // Filtering and Sorting
  const filteredRecords = useMemo(() => {
    return activeRecords
      .filter((r) => {
        if (selectedCategory !== 'Todas' && r.category !== selectedCategory) {
          return false;
        }
        if (selectedStatus !== 'Todos' && r.status !== selectedStatus) {
          return false;
        }
        if (selectedPriority !== 'Todas' && r.priority !== selectedPriority) {
          return false;
        }
        if (searchQuery.trim() !== '') {
          const q = searchQuery.toLowerCase();
          const matchTitle = r.title.toLowerCase().includes(q);
          const matchCode = r.code.toLowerCase().includes(q);
          const matchNotes = r.notes.toLowerCase().includes(q);
          if (!matchTitle && !matchCode && !matchNotes) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'updatedAt') {
          cmp = a.updatedAt.getTime() - b.updatedAt.getTime();
        } else if (sortBy === 'amount') {
          cmp = a.amount - b.amount;
        } else if (sortBy === 'code') {
          cmp = a.code.localeCompare(b.code);
        } else if (sortBy === 'title') {
          cmp = a.title.localeCompare(b.title);
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [
    activeRecords,
    selectedCategory,
    selectedStatus,
    selectedPriority,
    searchQuery,
    sortBy,
    sortDir,
  ]);

  // Metrics & Aggregations
  const metrics = useMemo(() => {
    const totalCount = activeRecords.length;
    const totalValue = activeRecords
      .filter((r) => r.status !== 'Archivado')
      .reduce((acc, r) => acc + r.amount, 0);
    const activeCount = activeRecords.filter((r) => r.status === 'Activo').length;
    const completedCount = activeRecords.filter((r) => r.status === 'Completado').length;
    const highPriorityCount = activeRecords.filter(
      (r) => r.priority === 'Alta' && r.status !== 'Archivado'
    ).length;

    const byCategory = RECORD_CATEGORIES.map((cat) => {
      const items = activeRecords.filter((r) => r.category === cat);
      const sum = items.reduce((acc, r) => acc + r.amount, 0);
      return {
        category: cat,
        count: items.length,
        sum,
        percentage: totalCount > 0 ? Math.round((items.length / totalCount) * 100) : 0,
      };
    });

    const byStatus = RECORD_STATUSES.map((st) => {
      const items = activeRecords.filter((r) => r.status === st);
      return {
        status: st,
        count: items.length,
        percentage: totalCount > 0 ? Math.round((items.length / totalCount) * 100) : 0,
      };
    });

    return {
      totalCount,
      totalValue,
      activeCount,
      completedCount,
      highPriorityCount,
      byCategory,
      byStatus,
    };
  }, [activeRecords]);

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      'ID',
      'Codigo',
      'Titulo',
      'Categoria',
      'Estado',
      'Prioridad',
      'Monto_USD',
      'Notas',
      'Actualizado',
    ];
    const rows = filteredRecords.map((r) => [
      r.id,
      r.code,
      `"${r.title.replace(/"/g, '""')}"`,
      r.category,
      r.status,
      r.priority,
      r.amount.toFixed(2),
      `"${r.notes.replace(/"/g, '""')}"`,
      r.updatedAt.toISOString(),
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `nexodb_records_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleSort = (field: 'updatedAt' | 'amount' | 'code' | 'title') => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  };

  const copyRecordJson = (record: DatabaseRecord) => {
    const payload = {
      _path: `/records/${record.id}`,
      id: record.id,
      title: record.title,
      code: record.code,
      category: record.category,
      status: record.status,
      priority: record.priority,
      amount: record.amount,
      notes: record.notes,
      ownerId: record.ownerId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 1800);
  };

  const getCategoryIcon = (cat: RecordCategory) => {
    switch (cat) {
      case 'Inventario':
        return <Package className="w-4 h-4 text-slate-500" />;
      case 'Clientes':
        return <Users className="w-4 h-4 text-slate-500" />;
      case 'Finanzas':
        return <Wallet className="w-4 h-4 text-slate-500" />;
      case 'Proyectos':
        return <FolderKanban className="w-4 h-4 text-slate-500" />;
      case 'Operaciones':
        return <Settings2 className="w-4 h-4 text-slate-500" />;
    }
  };

  const renderStatusIndicator = (status: RecordStatus) => {
    switch (status) {
      case 'Activo':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>Activo</span>
          </span>
        );
      case 'En Revision':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>En Revisión</span>
          </span>
        );
      case 'Completado':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>Completado</span>
          </span>
        );
      case 'Archivado':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Archive className="w-3.5 h-3.5 shrink-0" />
            <span>Archivado (Bloqueado)</span>
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50 text-slate-900">
      {/* Sidebar Navigation (260px on Desktop) */}
      <aside className="w-full lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col justify-between shrink-0">
        <div className="p-5">
          {/* Brand Header */}
          <div className="flex items-center justify-between lg:justify-start gap-2.5 pb-5 border-b border-slate-200">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                <Database className="w-4 h-4" />
              </div>
              <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
                NexoDB
              </span>
            </div>
            <span className="text-xs font-mono text-slate-500">Firestore</span>
          </div>

          {/* Primary Views */}
          <div className="mt-5">
            <p className="text-xs font-semibold text-slate-400 px-2.5 mb-2">
              Vistas del Espacio
            </p>
            <nav className="space-y-1">
              <button
                onClick={() => setActiveView('table')}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeView === 'table'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Layers className="w-4 h-4 shrink-0" />
                  <span>Tabla de Registros</span>
                </span>
                <span
                  className={`text-xs font-mono tabular-nums ${
                    activeView === 'table' ? 'text-slate-300' : 'text-slate-400'
                  }`}
                >
                  {activeRecords.length}
                </span>
              </button>

              <button
                onClick={() => setActiveView('analytics')}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeView === 'analytics'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <BarChart3 className="w-4 h-4 shrink-0" />
                  <span>Analítica en Vivo</span>
                </span>
              </button>

              <button
                onClick={() => setActiveView('schema')}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeView === 'schema'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Esquema y Reglas</span>
                </span>
              </button>
            </nav>
          </div>

          {/* Category Partition Filter */}
          <div className="mt-6">
            <p className="text-xs font-semibold text-slate-400 px-2.5 mb-2">
              Colecciones por Categoría
            </p>
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  setSelectedCategory('Todas');
                  setActiveView('table');
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selectedCategory === 'Todas'
                    ? 'bg-slate-100 text-slate-900 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span>Todas las categorías</span>
                <span className="font-mono tabular-nums text-slate-400">
                  {activeRecords.length}
                </span>
              </button>

              {RECORD_CATEGORIES.map((cat) => {
                const count = activeRecords.filter((r) => r.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => {
                      setSelectedCategory(cat);
                      setActiveView('table');
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      selectedCategory === cat
                        ? 'bg-slate-100 text-slate-900 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {getCategoryIcon(cat)}
                      <span>{cat}</span>
                    </span>
                    <span className="font-mono tabular-nums text-slate-400">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Account & Database Connection Panel */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/60">
          {user ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 truncate">
                    {user.displayName || 'Usuario Autenticado'}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{user.email}</p>
                </div>
                <button
                  onClick={handleSignOut}
                  title="Cerrar sesión"
                  className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 rounded-md transition-colors shrink-0"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                <span>Sincronizado con Cloud Firestore</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-700">/records</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="text-xs text-slate-600">
                Modo Vista Previa Local activo. Conecta tu cuenta para guardar en Cloud Firestore.
              </div>
              <button
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Conectar con Google</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb Trail on Left, Primary Actions on Right */}
        <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white border-b border-slate-200">
          <div className="flex items-center gap-2 text-sm text-slate-500 min-w-0 truncate">
            <span className="font-semibold text-slate-900 whitespace-nowrap shrink-0">
              NexoDB
            </span>
            <span aria-hidden="true">/</span>
            <span className="font-mono text-xs text-slate-600 whitespace-nowrap shrink-0">
              records
            </span>
            <span aria-hidden="true">/</span>
            <span className="text-slate-900 font-medium truncate">
              {activeView === 'table'
                ? selectedCategory === 'Todas'
                  ? 'Todos los Registros'
                  : selectedCategory
                : activeView === 'analytics'
                ? 'Analítica Operativa'
                : 'Esquema y Seguridad'}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleSeedDemoData}
              disabled={isSeeding}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSeeding ? 'animate-spin' : ''}`} />
              <span>Cargar Datos Demo</span>
            </button>

            <button
              onClick={openCreateModal}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Registro</span>
            </button>
          </div>
        </header>

        {/* Cloud Auth Banner when in Guest Preview Mode */}
        {!user && authReady && (
          <div className="bg-white border-b border-slate-200 px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              <span className="font-semibold text-slate-900">
                Base de Datos Firebase Firestore aprovisionada ({FIREBASE_PROJECT_ID}).
              </span>{' '}
              Actualmente estás explorando datos de demostración en memoria. Inicia sesión con Google para leer y escribir documentos persistentes en tiempo real.
            </div>
            <button
              onClick={handleGoogleSignIn}
              className="px-3.5 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              Iniciar Sesión con Google
            </button>
          </div>
        )}

        {(authError || dbError) && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-3 flex items-center justify-between gap-4 text-xs text-red-700">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{authError || dbError}</span>
            </div>
            <button
              onClick={() => {
                setAuthError(null);
                setDbError(null);
              }}
              className="text-red-700 hover:text-red-900 font-medium whitespace-nowrap shrink-0"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Main Workspace Container */}
        <main className="flex-1 p-6 space-y-6 max-w-[1440px] w-full mx-auto">
          {/* 4-Column KPI Strip */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500 flex items-center justify-between">
                <span>Total de Documentos</span>
                <span className="font-mono">/records</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {metrics.totalCount}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                <span>{metrics.activeCount} activos</span>
                <span aria-hidden="true"> · </span>
                <span>{metrics.completedCount} completados</span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500 flex items-center justify-between">
                <span>Valor Operativo Acumulado</span>
                <span className="font-mono">USD</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
                ${metrics.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Excluyendo registros archivados
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500 flex items-center justify-between">
                <span>Prioridad Alta</span>
                <span>Atención</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {metrics.highPriorityCount}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Registros críticos en curso
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500 flex items-center justify-between">
                <span>Motor de Persistencia</span>
                <span className="font-mono">NoSQL</span>
              </div>
              <div className="mt-2 text-lg font-bold text-slate-900 truncate">
                {user ? 'Cloud Firestore Activo' : 'Vista Previa Local'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {user ? 'Sincronización onSnapshot' : 'Listo para conectar cuenta'}
              </div>
            </div>
          </section>

          {/* VIEW 1: HIGH-DENSITY DATA TABLE */}
          {activeView === 'table' && (
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Table Control Toolbar */}
              <div className="p-4 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                {/* Search Input */}
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por código, título o notas..."
                    className="w-full pl-9 pr-8 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-indigo-600 transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Segmented Filter Controls */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* Status Filter */}
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    {(['Todos', ...RECORD_STATUSES] as const).map((st) => (
                      <button
                        key={st}
                        onClick={() => setSelectedStatus(st)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          selectedStatus === st
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {st === 'En Revision' ? 'En Revisión' : st}
                      </button>
                    ))}
                  </div>

                  {/* Priority Filter */}
                  <select
                    value={selectedPriority}
                    onChange={(e) =>
                      setSelectedPriority(e.target.value as RecordPriority | 'Todas')
                    }
                    aria-label="Filtrar por prioridad"
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  >
                    <option value="Todas">Prioridad: Todas</option>
                    {RECORD_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        Prioridad: {p}
                      </option>
                    ))}
                  </select>

                  {/* Export CSV Button */}
                  <button
                    onClick={handleExportCSV}
                    disabled={filteredRecords.length === 0}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Exportar CSV</span>
                  </button>
                </div>
              </div>

              {/* Loading Skeleton State */}
              {loadingRecords ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      className="h-10 bg-slate-100 animate-pulse rounded-lg"
                    />
                  ))}
                </div>
              ) : filteredRecords.length === 0 ? (
                /* Empty State */
                <div className="p-12 text-center max-w-md mx-auto">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center mx-auto mb-3">
                    <Database className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900">
                    No se encontraron registros en esta vista
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                    {activeRecords.length === 0
                      ? 'Tu colección de Firestore está vacía. Crea tu primer registro estructurado o inserta el lote de datos de demostración con un clic.'
                      : 'Ningún documento coincide con los filtros de búsqueda activos.'}
                  </p>
                  <div className="mt-5 flex items-center justify-center gap-3">
                    {activeRecords.length === 0 ? (
                      <>
                        <button
                          onClick={openCreateModal}
                          className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
                        >
                          Crear Primer Registro
                        </button>
                        <button
                          onClick={handleSeedDemoData}
                          className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                        >
                          Cargar 6 Registros Demo
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setSelectedCategory('Todas');
                          setSelectedStatus('Todos');
                          setSelectedPriority('Todas');
                          setSearchQuery('');
                        }}
                        className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        Limpiar Filtros
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* Populated High-Density Data Grid */
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-500">
                        <th className="py-3 px-4 w-32">
                          <button
                            onClick={() => toggleSort('code')}
                            className="flex items-center gap-1 hover:text-slate-900 whitespace-nowrap shrink-0"
                          >
                            <span>Código</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="py-3 px-4">
                          <button
                            onClick={() => toggleSort('title')}
                            className="flex items-center gap-1 hover:text-slate-900 whitespace-nowrap shrink-0"
                          >
                            <span>Registro / Descripción</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="py-3 px-4 w-36">Categoría</th>
                        <th className="py-3 px-4 w-44">Estado</th>
                        <th className="py-3 px-4 w-28">Prioridad</th>
                        <th className="py-3 px-4 w-36 text-right">
                          <button
                            onClick={() => toggleSort('amount')}
                            className="inline-flex items-center gap-1 hover:text-slate-900 ml-auto whitespace-nowrap shrink-0"
                          >
                            <span>Valor (USD)</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="py-3 px-4 w-36">
                          <button
                            onClick={() => toggleSort('updatedAt')}
                            className="flex items-center gap-1 hover:text-slate-900 whitespace-nowrap shrink-0"
                          >
                            <span>Actualizado</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="py-3 px-4 w-36 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {filteredRecords.map((record) => {
                        const isArchived = record.status === 'Archivado';
                        return (
                          <tr
                            key={record.id}
                            className="hover:bg-slate-50/90 transition-colors group"
                          >
                            <td className="py-2.5 px-4 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">
                              {record.code}
                            </td>
                            <td className="py-2.5 px-4 max-w-md">
                              <div className="font-medium text-slate-900 truncate">
                                {record.title}
                              </div>
                              {record.notes && (
                                <div className="text-xs text-slate-500 truncate mt-0.5">
                                  {record.notes}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                {getCategoryIcon(record.category)}
                                <span>{record.category}</span>
                              </span>
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              {isArchived ? (
                                renderStatusIndicator(record.status)
                              ) : (
                                <select
                                  value={record.status}
                                  onChange={(e) =>
                                    handleQuickStatusChange(
                                      record,
                                      e.target.value as RecordStatus
                                    )
                                  }
                                  aria-label={`Cambiar estado de ${record.title}`}
                                  className="text-xs font-medium bg-transparent border border-slate-200 rounded-md px-2 py-1 text-slate-800 hover:border-slate-300 focus:outline-none focus:border-indigo-600"
                                >
                                  {RECORD_STATUSES.map((st) => (
                                    <option key={st} value={st}>
                                      {st === 'En Revision' ? 'En Revisión' : st}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-xs whitespace-nowrap">
                              <span
                                className={
                                  record.priority === 'Alta'
                                    ? 'font-semibold text-red-700'
                                    : record.priority === 'Media'
                                    ? 'font-medium text-amber-700'
                                    : 'text-slate-600'
                                }
                              >
                                {record.priority}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                              ${record.amount.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                              {record.updatedAt.toLocaleDateString('es-ES', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-2.5 px-4 text-right whitespace-nowrap">
                              {deleteConfirmId === record.id ? (
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleDeleteRecord(record.id)}
                                    className="px-2 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                                  >
                                    Confirmar
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmId(null)}
                                    className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              ) : (
                                <div className="inline-flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => setInspectedRecord(record)}
                                    title="Inspeccionar documento JSON"
                                    className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-md transition-colors"
                                  >
                                    <Code2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => openEditModal(record)}
                                    disabled={isArchived}
                                    title={
                                      isArchived
                                        ? 'Los registros archivados están bloqueados contra edición'
                                        : 'Editar registro'
                                    }
                                    className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmId(record.id)}
                                    title="Eliminar registro"
                                    className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Table Footer Summary */}
              <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <div>
                  Mostrando{' '}
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    {filteredRecords.length}
                  </span>{' '}
                  de{' '}
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    {activeRecords.length}
                  </span>{' '}
                  documentos
                </div>
                <div className="font-mono tabular-nums">
                  Suma filtrada: $
                  {filteredRecords
                    .reduce((acc, r) => acc + r.amount, 0)
                    .toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                </div>
              </div>
            </section>
          )}

          {/* VIEW 2: REAL-TIME ANALYTICS */}
          {activeView === 'analytics' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Category Distribution */}
              <section className="bg-white border border-slate-200 rounded-xl p-6">
                <h2 className="text-base font-semibold text-slate-900">
                  Distribución y Valor por Categoría
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Desglose en tiempo real de los documentos almacenados en la colección.
                </p>

                <div className="mt-6 space-y-4">
                  {metrics.byCategory.map((item) => (
                    <div key={item.category} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-800 flex items-center gap-2">
                          {getCategoryIcon(item.category)}
                          <span>{item.category}</span>
                        </span>
                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          <span className="text-slate-500">{item.count} docs</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-slate-900">
                            ${item.sum.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(item.percentage, item.count > 0 ? 6 : 0)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Lifecycle Status Breakdown */}
              <section className="bg-white border border-slate-200 rounded-xl p-6">
                <h2 className="text-base font-semibold text-slate-900">
                  Estado del Ciclo de Vida de Registros
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Proporción operativa e invariante de bloqueo terminal para documentos archivados.
                </p>

                <div className="mt-6 space-y-4">
                  {metrics.byStatus.map((item) => (
                    <div
                      key={item.status}
                      className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0"
                    >
                      <div>{renderStatusIndicator(item.status)}</div>
                      <div className="flex items-center gap-4 font-mono text-xs tabular-nums">
                        <span className="text-slate-500">{item.percentage}%</span>
                        <span className="font-semibold text-slate-900 w-16 text-right">
                          {item.count} regs
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* VIEW 3: SCHEMA & SECURITY BLUEPRINT */}
          {activeView === 'schema' && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Esquema de Entidad y Reglas Zero-Trust
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Definición formal validada tanto en el cliente como en las reglas de seguridad de Cloud Firestore.
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-600">
                  Colección: /records/&#123;recordId&#125;
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-xs font-semibold text-slate-700 mb-3">
                    Propiedades del Documento (RecordItem)
                  </h3>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-xs">
                    <div className="p-3 flex justify-between">
                      <span className="font-mono font-semibold text-slate-900">title</span>
                      <span className="text-slate-500 font-mono">string (1..120 chars)</span>
                    </div>
                    <div className="p-3 flex justify-between">
                      <span className="font-mono font-semibold text-slate-900">code</span>
                      <span className="text-slate-500 font-mono">string ^[a-zA-Z0-9_\-]+$ (1..32)</span>
                    </div>
                    <div className="p-3 flex justify-between">
                      <span className="font-mono font-semibold text-slate-900">category</span>
                      <span className="text-slate-500 font-mono">enum (5 categorías)</span>
                    </div>
                    <div className="p-3 flex justify-between">
                      <span className="font-mono font-semibold text-slate-900">status</span>
                      <span className="text-slate-500 font-mono">enum (Bloqueo en Archivado)</span>
                    </div>
                    <div className="p-3 flex justify-between">
                      <span className="font-mono font-semibold text-slate-900">priority</span>
                      <span className="text-slate-500 font-mono">enum (Alta | Media | Baja)</span>
                    </div>
                    <div className="p-3 flex justify-between">
                      <span className="font-mono font-semibold text-slate-900">amount</span>
                      <span className="text-slate-500 font-mono">number (-10^9 .. 10^9)</span>
                    </div>
                    <div className="p-3 flex justify-between">
                      <span className="font-mono font-semibold text-slate-900">ownerId</span>
                      <span className="text-slate-500 font-mono">request.auth.uid (Inmutable)</span>
                    </div>
                    <div className="p-3 flex justify-between">
                      <span className="font-mono font-semibold text-slate-900">createdAt / updatedAt</span>
                      <span className="text-slate-500 font-mono">timestamp == request.time</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-700 mb-3">
                    Garantías de Seguridad Activas en Firestore
                  </h3>
                  <ul className="space-y-2.5 text-xs text-slate-600 leading-relaxed border border-slate-200 rounded-lg p-4 bg-slate-50/50">
                    <li>
                      <strong className="text-slate-900">Aislamiento por Propietario:</strong>{' '}
                      Cada consulta y lectura verifica estrictamente que{' '}
                      <code className="font-mono text-slate-800">resource.data.ownerId == request.auth.uid</code>.
                    </li>
                    <li>
                      <strong className="text-slate-900">Prevención de Campos Fantasma:</strong>{' '}
                      El validador <code className="font-mono text-slate-800">isValidRecordItem()</code> exige{' '}
                      <code className="font-mono text-slate-800">hasAll</code> y{' '}
                      <code className="font-mono text-slate-800">hasOnly</code> en cada escritura.
                    </li>
                    <li>
                      <strong className="text-slate-900">Integridad Temporal del Servidor:</strong>{' '}
                      Las marcas de tiempo deben coincidir exactamente con{' '}
                      <code className="font-mono text-slate-800">request.time</code>.
                    </li>
                    <li>
                      <strong className="text-slate-900">Bloqueo de Estado Terminal:</strong>{' '}
                      Una vez que un registro pasa a estado{' '}
                      <code className="font-mono text-slate-800">Archivado</code>, queda bloqueado contra modificaciones posteriores.
                    </li>
                  </ul>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {/* JSON Document Inspector Slide-Over Drawer */}
      {inspectedRecord && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur-[1px]">
          <div className="w-full max-w-lg bg-white h-full border-l border-slate-200 flex flex-col justify-between shadow-xl">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileJson className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Inspector de Documento NoSQL
                </h3>
              </div>
              <button
                onClick={() => setInspectedRecord(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto space-y-4">
              <div>
                <div className="text-xs text-slate-500">Ruta del Documento</div>
                <div className="mt-1 font-mono text-xs text-slate-900 bg-slate-100 px-3 py-2 rounded-lg break-all">
                  /databases/{FIRESTORE_DATABASE_ID}/documents/records/{inspectedRecord.id}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  Payload JSON en Tiempo Real
                </span>
                <button
                  onClick={() => copyRecordJson(inspectedRecord)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {copiedJson ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar JSON</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed">
                {JSON.stringify(
                  {
                    id: inspectedRecord.id,
                    code: inspectedRecord.code,
                    title: inspectedRecord.title,
                    category: inspectedRecord.category,
                    status: inspectedRecord.status,
                    priority: inspectedRecord.priority,
                    amount: inspectedRecord.amount,
                    notes: inspectedRecord.notes,
                    ownerId: inspectedRecord.ownerId,
                    createdAt: inspectedRecord.createdAt.toISOString(),
                    updatedAt: inspectedRecord.updatedAt.toISOString(),
                  },
                  null,
                  2
                )}
              </pre>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              {inspectedRecord.status !== 'Archivado' && (
                <button
                  onClick={() => {
                    const rec = inspectedRecord;
                    setInspectedRecord(null);
                    openEditModal(rec);
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                >
                  Editar Documento
                </button>
              )}
              <button
                onClick={() => setInspectedRecord(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Record Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[1px]">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingRecord ? 'Editar Registro' : 'Nuevo Registro en Base de Datos'}
              </h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRecord} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Código Identificador
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={VALIDATION_LIMITS.CODE_MAX}
                    value={formData.code}
                    onChange={(e) =>
                      setFormData({ ...formData, code: e.target.value })
                    }
                    placeholder="REG-1001"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-600"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Título o Nombre del Registro
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={VALIDATION_LIMITS.TITLE_MAX}
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                    placeholder="Ej. Servidor de Base de Datos Principal"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Categoría
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        category: e.target.value as RecordCategory,
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-600"
                  >
                    {RECORD_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Estado
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        status: e.target.value as RecordStatus,
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-600"
                  >
                    {RECORD_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st === 'En Revision' ? 'En Revisión' : st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Prioridad
                  </label>
                  <select
                    value={formData.priority}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        priority: e.target.value as RecordPriority,
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-600"
                  >
                    {RECORD_PRIORITIES.map((pr) => (
                      <option key={pr} value={pr}>
                        {pr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Valor Monetario / Cantidad (USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={formData.amount}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      amount: parseFloat(e.target.value || '0'),
                    })
                  }
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Notas o Especificaciones Técnicas
                  </label>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    {formData.notes.length}/{VALIDATION_LIMITS.NOTES_MAX}
                  </span>
                </div>
                <textarea
                  rows={3}
                  maxLength={VALIDATION_LIMITS.NOTES_MAX}
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  placeholder="Detalles adicionales del registro..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isSaving
                    ? 'Guardando...'
                    : editingRecord
                    ? 'Guardar Cambios'
                    : 'Crear Documento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
