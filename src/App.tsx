import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { EngineConfig, IntentModel, TargetId, WorkflowNode, WorkflowNodeType } from './lib/types.ts';
import { cloneModel } from './lib/types.ts';
import { lint } from './lib/lint.ts';
import { generate, generatePreviewDoc } from './lib/generate.ts';
import {
  buildHeroPreviewDoc,
  codeToPictureDataUrl,
  looksLikeCode,
  reverseFromCode,
  reverseFromImage,
  SAMPLE_REVERSE_IMAGES,
  type ImageVisualMeta,
  type ReverseResult,
  type SampleReverseImage,
} from './lib/reverse.ts';
import { createEngine } from './lib/engine.ts';
import {
  applyPropToWorkflow,
  ensureWorkflow,
  isWorkflowTarget,
  normalizeGraph,
  propsFromWorkflow,
  WORKFLOW_KIND,
} from './lib/workflow.ts';
import { useSpeech } from './lib/useSpeech.ts';
import type { UsageStats, VaultSecret } from './lib/vault.ts';
import {
  bumpUsage,
  clearSessionSecret,
  fetchServerVaultStatus,
  getServerSessionId,
  loadSessionSecret,
  loadUsage,
  purgeAllKeys,
} from './lib/vault.ts';
import {
  auth,
  loginWithGoogle,
  logoutUser,
  onAuthStateChanged,
  saveTranslationWorkflow,
  subscribeToUserTranslations,
  deleteTranslationWorkflow,
  testConnection,
  type SavedTranslationRecord,
} from './lib/firebase.ts';
import MicButton from './components/MicButton.tsx';
import VaultPanel from './components/VaultPanel.tsx';
import IntentPanel from './components/IntentPanel.tsx';
import CodePanel from './components/CodePanel.tsx';
import PreviewPanel from './components/PreviewPanel.tsx';
import CoverLanding from './components/CoverLanding.tsx';
import MembershipModal, { type MembershipTierId } from './components/MembershipModal.tsx';
import LinuxWidgetModal from './components/LinuxWidgetModal.tsx';

type Mode = 'cover' | 'speak' | 'reverse' | 'picture';

const TARGETS: { id: TargetId; label: string }[] = [
  { id: 'nextjs', label: 'Next.js / React (TSX)' },
  { id: 'html', label: 'HTML + CSS' },
  { id: 'python', label: 'Python' },
  { id: 'typescript', label: 'TypeScript contract' },
  { id: 'json', label: 'Intent model (JSON)' },
  { id: 'shell', label: 'POSIX Shell / DevOps Pipeline' },
  { id: 'workflow', label: 'Workflow Automation / DAG' },
];

const QUICK_PHRASES = [
  'Build a wooden table, 48 inch top, 2 inch legs',
  'Make the legs 29 inches',
  'Select the top width',
  'Make it wider',
  'A blue button that says "Save"',
];

const WORKFLOW_PHRASES = [
  'When I say deploy, run the tests, then build, then push to main',
  'Every night at 2am find old .log files in the logs folder, compress them, then delete old logs',
  'When a webhook arrives, summarize the payload, then notify slack',
  'then check disk space',
];

const DEFAULT_HERO_CODE = `"use client"

import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

interface HeroProps {
  eyebrow?: string
  title: string
  subtitle: string
  ctaLabel?: string
  ctaHref?: string
}

export function Hero({
  eyebrow = "Innovate Without Limits",
  title,
  subtitle,
  ctaLabel = "Explore Now",
  ctaHref = "#",
}: HeroProps) {
  return (
    <section
      id="hero"
      className="relative mx-auto w-full pt-40 px-6 text-center md:px-8 
      min-h-[calc(100vh-40px)] overflow-hidden 
      bg-[linear-gradient(to_bottom,#fff,#ffffff_50%,#e8e8e8_88%)]  
      dark:bg-[linear-gradient(to_bottom,#000,#0000_30%,#898e8e_78%,#ffffff_99%_50%)] 
      rounded-b-xl"
    >
      {/* Grid BG */}
      <div
        className="absolute -z-10 inset-0 opacity-80 h-[600px] w-full 
        bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] 
        dark:bg-[linear-gradient(to_right,#333_1px,transparent_1px),linear-gradient(to_bottom,#333_1px,transparent_1px)]
        bg-[size:6rem_5rem] 
        [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]"
      />

      {/* Radial Accent */}
      <div
        className="absolute left-1/2 top-[calc(100%-90px)] lg:top-[calc(100%-150px)] 
        h-[500px] w-[700px] md:h-[500px] md:w-[1100px] lg:h-[750px] lg:w-[140%] 
        -translate-x-1/2 rounded-[100%] border-[#B48CDE] bg-white dark:bg-black 
        bg-[radial-gradient(closest-side,#fff_82%,#000000)] 
        dark:bg-[radial-gradient(closest-side,#000_82%,#ffffff)] 
        animate-fade-up"
      />

      {/* Eyebrow */}
      {eyebrow && (
        <a href="#" className="group">
          <span
            className="text-sm text-gray-600 dark:text-gray-400 font-geist mx-auto px-5 py-2 
            bg-gradient-to-tr from-zinc-300/5 via-gray-400/5 to-transparent  
            border-[2px] border-gray-300/20 dark:border-white/5 
            rounded-3xl w-fit tracking-tight uppercase flex items-center justify-center"
          >
            {eyebrow}
            <ChevronRight className="inline w-4 h-4 ml-2 transition-transform duration-300 group-hover:translate-x-1" />
          </span>
        </a>
      )}

      {/* Title */}
      <h1
        className="animate-fade-in -translate-y-4 text-balance 
        bg-gradient-to-br from-black from-30% to-black/40 
        bg-clip-text py-6 text-5xl font-semibold leading-none tracking-tighter 
        text-transparent opacity-0 sm:text-6xl md:text-7xl lg:text-8xl 
        dark:from-white dark:to-white/40"
      >
        {title}
      </h1>

      {/* Subtitle */}
      <p
        className="animate-fade-in mb-12 -translate-y-4 text-balance 
        text-lg tracking-tight text-gray-600 dark:text-gray-400 
        opacity-0 md:text-xl"
      >
        {subtitle}
      </p>

      {/* CTA */}
      {ctaLabel && (
        <div className="flex justify-center">
          <Button
            asChild
            className="mt-[-20px] w-fit md:w-52 z-20 font-geist tracking-tighter text-center text-lg"
          >
            <a href={ctaHref}>{ctaLabel}</a>
          </Button>
        </div>
      )}

      {/* Bottom Fade */}
      <div
        className="animate-fade-up relative mt-32 opacity-0 [perspective:2000px] 
        after:absolute after:inset-0 after:z-50 
        after:[background:linear-gradient(to_top,hsl(var(--background))_10%,transparent)]"
      />
    </section>
  )
}`;

const PLACEHOLDER_DOC = `<!doctype html>
<html><head><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
font-family:ui-sans-serif,system-ui,sans-serif;background:radial-gradient(120% 120% at 20% 0%,#f8fafc,#e2e8f0);color:#64748b}
div{text-align:center;line-height:1.7}b{color:#0f172a;font-size:15px}
</style></head><body><div><b>Scratch render waiting</b><br>Speak or type an intent on the left,<br>or paste code in reverse mode.</div></body></html>`;

function loadEngineConfig(): EngineConfig {
  try {
    const raw = localStorage.getItem('ct.engine');
    if (raw) {
      const parsed = JSON.parse(raw) as EngineConfig & { apiKey?: string };
      return { id: parsed.id === 'remote' ? 'remote' : 'local', endpoint: parsed.endpoint, model: parsed.model };
    }
  } catch {
    /* ignore */
  }
  return { id: 'local' };
}

interface LogItem {
  id: string;
  text: string;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('cover');
  const [target, setTarget] = useState<TargetId>('nextjs');
  const [model, setModel] = useState<IntentModel | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [history, setHistory] = useState<IntentModel[]>([]);
  const [log, setLog] = useState<LogItem[]>([]);
  const logCounterRef = useRef(0);
  const [transcript, setTranscript] = useState('');
  const [reverseCode, setReverseCode] = useState(DEFAULT_HERO_CODE);
  const [reverse, setReverse] = useState<ReverseResult | null>(null);
  const [pictureDataUrl, setPictureDataUrl] = useState<string>(SAMPLE_REVERSE_IMAGES[0].dataUrl);
  const [pictureFileName, setPictureFileName] = useState<string>('saas-pricing-card.svg');
  const [pictureSampleId, setPictureSampleId] = useState<string | undefined>(SAMPLE_REVERSE_IMAGES[0].id);
  const [pictureHint, setPictureHint] = useState<string>('');
  const [pictureCodeInput, setPictureCodeInput] = useState<string>('');
  const [pictureMeta, setPictureMeta] = useState<ImageVisualMeta | null>(null);
  const [pictureProvider, setPictureProvider] = useState<string>('local-vision');
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [showReverseSource, setShowReverseSource] = useState<boolean>(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [engineConfig, setEngineConfig] = useState<EngineConfig>(loadEngineConfig);
  const [busy, setBusy] = useState(false);
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [linuxWidgetOpen, setLinuxWidgetOpen] = useState(false);

  // Session vs Vault API key
  const [vaultSecret, setVaultSecret] = useState<VaultSecret | null>(loadSessionSecret);
  const [isSessionOnly, setIsSessionOnly] = useState<boolean>(() => loadSessionSecret() !== null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(getServerSessionId);
  const [serverMaskedKey, setServerMaskedKey] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageStats>(loadUsage);
  const autoLockRef = useRef<number | null>(null);

  // Firebase auth & cloud state
  const [user, setUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [savedWorkflows, setSavedWorkflows] = useState<SavedTranslationRecord[]>([]);
  const [firebaseOnline, setFirebaseOnline] = useState(false);

  const pushLog = useCallback((message: string) => {
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logCounterRef.current += 1;
    const item: LogItem = {
      id: `log_${Date.now()}_${logCounterRef.current}`,
      text: `${stamp} — ${message}`,
    };
    setLog((entries) => [item, ...entries].slice(0, 16));
  }, []);

  // 0. Check for active backend in-memory session
  useEffect(() => {
    let mounted = true;
    fetchServerVaultStatus().then((status) => {
      if (!mounted) return;
      if (status.hasSessionKey && status.maskedKey) {
        setServerMaskedKey(status.maskedKey);
        setIsSessionOnly(true);
        setVaultSecret({ apiKey: '', endpoint: status.endpoint, model: status.model });
        setEngineConfig((prev) => ({
          ...prev,
          id: 'remote',
          endpoint: status.endpoint,
          model: status.model,
          sessionId: getServerSessionId() || undefined,
        }));
        pushLog('Backend in-memory session active (zero browser storage).');
      }
    });
    return () => {
      mounted = false;
    };
  }, [pushLog]);

  // 1. Initial Firestore connection test
  useEffect(() => {
    let mounted = true;
    testConnection()
      .then((ok) => {
        if (!mounted) return;
        setFirebaseOnline(ok);
        if (ok) pushLog('Firebase Firestore connected.');
      })
      .catch(() => {
        if (mounted) setFirebaseOnline(false);
      });
    return () => {
      mounted = false;
    };
  }, [pushLog]);

  // 2. Firebase Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        pushLog(`Signed in as ${currentUser.email || currentUser.displayName}`);
      }
    });
    return () => unsub();
  }, [pushLog]);

  // 3. Real-time subscriber to user saved translation workflows
  useEffect(() => {
    if (!user) {
      setSavedWorkflows([]);
      return;
    }
    const unsub = subscribeToUserTranslations(
      user.uid,
      (list) => setSavedWorkflows(list),
      (err) => pushLog(`Firestore sync notice: ${(err as Error).message}`),
    );
    return () => unsub();
  }, [user, pushLog]);

  const armAutoLock = useCallback(() => {
    if (autoLockRef.current) window.clearTimeout(autoLockRef.current);
    autoLockRef.current = window.setTimeout(() => {
      setVaultSecret((current) => {
        if (current) pushLog('Key vault auto-locked after 15 minutes idle.');
        return null;
      });
      setIsSessionOnly(false);
      clearSessionSecret();
    }, 15 * 60 * 1000);
  }, [pushLog]);

  useEffect(() => {
    return () => {
      if (autoLockRef.current) window.clearTimeout(autoLockRef.current);
    };
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const previous = h[h.length - 1];
      setModel(previous);
      pushLog('Reverted one step.');
      return h.slice(0, -1);
    });
  }, [pushLog]);

  const handleUtterance = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      if (/^(undo|revert|go back|undo that)\b/i.test(clean)) {
        undo();
        return;
      }
      setBusy(true);
      try {
        const isRemote = engineConfig.id === 'remote';
        const engine = createEngine({
          ...engineConfig,
          apiKey: vaultSecret?.apiKey,
          sessionId: backendSessionId || getServerSessionId() || undefined,
        });
        const result = await engine.translate(clean, model, selection, target);
        setHistory((h) => (model ? [...h, model] : h).slice(-40));
        setModel(result.model);
        setSelection(result.selection);
        pushLog(result.message);
        if (result.model.workflow && !isWorkflowTarget(target)) {
          setTarget('workflow');
          pushLog('Switched target to Workflow / DAG to show the canvas.');
        }
        if (isRemote) {
          setUsage(bumpUsage(clean.length, JSON.stringify(result.model).length));
          armAutoLock();
        }
      } catch (error) {
        pushLog(`Engine error: ${(error as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [engineConfig, model, selection, target, pushLog, undo, vaultSecret, backendSessionId, armAutoLock],
  );

  const speech = useSpeech((text, isFinal) => {
    if (isFinal) {
      setTranscript('');
      void handleUtterance(text);
    }
  });

  const handlePropChange = useCallback(
    (key: string, value: string | number | boolean) => {
      if (!model) return;
      const next = cloneModel(model);
      const prop = next.props.find((p) => p.key === key);
      if (!prop) return;
      prop.value = value;
      prop.confidence = Math.max(prop.confidence, 0.9);
      prop.source = prop.source?.startsWith('voice') ? prop.source : 'manual edit';
      applyPropToWorkflow(next, key);
      next.updatedAt = Date.now();
      next.warnings = lint(next);
      setHistory((h) => [...h, model].slice(-40));
      setModel(next);
      setReverse((prev) =>
        prev
          ? {
              ...prev,
              model: next,
              previewDoc: next.kind === 'ui/hero' ? buildHeroPreviewDoc(next) : generatePreviewDoc(next),
            }
          : null,
      );
      setSelection(key);
      pushLog(`${prop.label} → ${String(value)}${prop.unit ?? ''} (manual edit)`);
    },
    [model, pushLog],
  );

  const handleUpdateWorkflowNode = useCallback(
    (nodeId: string, patch: Partial<WorkflowNode>) => {
      const baseModel: IntentModel =
        model ?? {
          id: 'wf_live',
          kind: WORKFLOW_KIND,
          label: 'LiveWorkflow',
          props: [],
          warnings: [],
          updatedAt: Date.now(),
        };
      const next = cloneModel(baseModel);
      const wf = cloneModel({ ...next, workflow: ensureWorkflow(next, `${next.label}.sh`) }).workflow!;
      const targetNode = wf.nodes.find((n) => n.id === nodeId);
      if (!targetNode) return;
      if (patch.label !== undefined) targetNode.label = patch.label;
      if (patch.command !== undefined) targetNode.command = patch.command;
      if (patch.detail !== undefined) targetNode.detail = patch.detail;
      next.workflow = normalizeGraph(wf);
      if (next.kind === WORKFLOW_KIND) {
        next.props = propsFromWorkflow(next.workflow, 'workflow canvas edit');
      } else {
        const matchingProp = next.props.find((p) => p.nodeId === nodeId || p.key === nodeId);
        if (matchingProp) {
          matchingProp.value = targetNode.command ?? targetNode.detail ?? targetNode.label;
        }
      }
      next.updatedAt = Date.now();
      next.warnings = lint(next);
      setModel(next);
      setSelection(nodeId);
      pushLog(`Updated workflow stage "${targetNode.label}" (${nodeId}).`);
    },
    [model, pushLog],
  );

  const handleAddWorkflowNode = useCallback(
    (type: WorkflowNodeType) => {
      const baseModel: IntentModel =
        model ?? {
          id: 'wf_live',
          kind: WORKFLOW_KIND,
          label: 'LiveWorkflow',
          props: [],
          warnings: [],
          updatedAt: Date.now(),
        };
      const next = cloneModel(baseModel);
      const wf = cloneModel({ ...next, workflow: ensureWorkflow(next, `${next.label}.sh`) }).workflow!;
      const idx = wf.nodes.length + 1;
      const newId = wf.nodes.some((n) => n.id.startsWith('step.')) ? `step.${idx}` : `stage.step${idx}`;
      const prevLast = wf.nodes[wf.nodes.length - 1];
      wf.nodes.push({
        id: newId,
        type,
        label: `Step ${idx}: Verify & Emit`,
        command: 'echo "verified step"',
        destination: 'terminal',
      });
      if (prevLast) {
        wf.edges.push({ from: prevLast.id, to: newId });
      }
      next.workflow = normalizeGraph(wf);
      if (next.kind === WORKFLOW_KIND) {
        next.props = propsFromWorkflow(next.workflow, 'added workflow step');
      }
      next.updatedAt = Date.now();
      next.warnings = lint(next);
      setHistory((h) => (model ? [...h, model] : h).slice(-40));
      setModel(next);
      setSelection(newId);
      pushLog(`Added workflow stage "${newId}" to DAG.`);
    },
    [model, pushLog],
  );

  // Unified Code -> Picture & Workflow handler (works from Code -> Visual, Picture -> Code, or CodePanel)
  const applyCodeToPictureAndWorkflow = useCallback(
    (codeText: string, stayInPictureMode = false) => {
      const clean = codeText.trim();
      if (!clean) return;
      const result = reverseFromCode(clean);
      const svgUrl = codeToPictureDataUrl(result.model);
      const primaryColor = String(
        result.model.props.find((p) => p.key === 'primaryColor' || p.key === 'color')?.value ?? '#38bdf8',
      );
      const backgroundColor = String(
        result.model.props.find((p) => p.key === 'backgroundColor')?.value ?? '#0f172a',
      );
      const widthVal = Number(
        result.model.props.find((p) => p.key === 'width' || p.key === 'top.width')?.value ?? 480,
      );

      setHistory((h) => (model ? [...h, model] : h).slice(-40));
      setReverseCode(clean);
      setReverse(result);
      setModel(result.model);
      setPictureDataUrl(svgUrl);
      setPictureFileName(`${result.model.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`);
      setPictureSampleId(undefined);
      setPictureProvider('code-to-picture');
      setPictureMeta({
        width: Number.isFinite(widthVal) && widthVal > 0 ? widthVal : 480,
        height: 320,
        primaryColor,
        backgroundColor,
        fileName: `${result.model.label}.svg`,
      });
      setSelection(result.model.props[0]?.nodeId ?? result.model.workflow?.nodes[0]?.id ?? null);
      if (!stayInPictureMode && mode !== 'reverse' && mode !== 'picture') {
        setMode('reverse');
      }
      pushLog(
        `Code → Picture & Workflow: "${result.model.label}" (${result.model.props.length} props, ${
          result.model.workflow?.nodes.length ?? 4
        } DAG stages connected).`,
      );
    },
    [model, mode, pushLog],
  );

  // Reverse mode: code -> semantic model + visual + picture thumbnail + workflow, on debounce
  useEffect(() => {
    if (mode !== 'reverse') return;
    const timer = setTimeout(() => {
      if (!reverseCode.trim()) {
        setReverse(null);
        return;
      }
      const result = reverseFromCode(reverseCode);
      const svgUrl = codeToPictureDataUrl(result.model);
      setReverse(result);
      setModel(result.model);
      setPictureDataUrl(svgUrl);
      setPictureFileName(`${result.model.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`);
      setPictureSampleId(undefined);
      setSelection((prev) => prev ?? result.model.props[0]?.nodeId ?? null);
      pushLog(result.note);
    }, 380);
    return () => clearTimeout(timer);
  }, [reverseCode, mode, pushLog]);

  // Picture -> Code reverse handler (also detects if user pasted code into the hint box!)
  const runPictureReverse = useCallback(
    async (opts?: { dataUrl?: string; fileName?: string; sampleId?: string; hintText?: string }) => {
      const activeHint = opts?.hintText ?? pictureHint;
      // If user pasted code into the hint input box in Picture -> Code, convert that code into Picture & Workflow!
      if (!opts?.dataUrl && !opts?.sampleId && looksLikeCode(activeHint)) {
        applyCodeToPictureAndWorkflow(activeHint, true);
        setPictureHint('');
        return;
      }

      const activeDataUrl = opts?.dataUrl ?? pictureDataUrl;
      if (!activeDataUrl) return;
      const activeFileName = opts?.fileName ?? pictureFileName;
      const activeSampleId = 'sampleId' in (opts || {}) ? opts?.sampleId : pictureSampleId;

      setBusy(true);
      try {
        const res = await reverseFromImage({
          imageBase64: activeDataUrl,
          fileName: activeFileName,
          sampleId: activeSampleId,
          hint: activeHint,
          target,
          apiKey: vaultSecret?.apiKey,
          endpoint: vaultSecret?.endpoint || engineConfig.endpoint,
          model: vaultSecret?.model || engineConfig.model,
          sessionId: backendSessionId || getServerSessionId() || undefined,
        });
        setHistory((h) => (model ? [...h, model] : h).slice(-40));
        setModel(res.model);
        setReverse(res);
        setReverseCode(res.code);
        setPictureMeta(res.meta);
        setPictureProvider(res.provider);
        setSelection(res.model.props[0]?.nodeId ?? null);
        pushLog(res.note);
        if (res.provider !== 'local-vision') {
          setUsage(bumpUsage(500, JSON.stringify(res.model).length));
          armAutoLock();
        }
      } catch (err) {
        pushLog(`Picture reverse error: ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [
      pictureDataUrl,
      pictureFileName,
      pictureSampleId,
      pictureHint,
      target,
      vaultSecret,
      engineConfig,
      backendSessionId,
      model,
      pushLog,
      armAutoLock,
      applyCodeToPictureAndWorkflow,
    ],
  );

  // Auto-run initial sample picture when entering Picture -> Code mode if no picture has been reversed yet
  useEffect(() => {
    if (mode === 'picture' && !pictureMeta && pictureDataUrl) {
      void runPictureReverse({
        dataUrl: pictureDataUrl,
        fileName: pictureFileName,
        sampleId: pictureSampleId,
      });
    }
  }, [mode, pictureMeta, pictureDataUrl, pictureFileName, pictureSampleId, runPictureReverse]);

  const handleImageFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        pushLog('Please select a valid image file (PNG, JPG, WebP, SVG).');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const resultUrl = String(reader.result || '');
        if (!resultUrl) return;
        setPictureDataUrl(resultUrl);
        setPictureFileName(file.name);
        setPictureSampleId(undefined);
        if (mode !== 'picture') setMode('picture');
        void runPictureReverse({
          dataUrl: resultUrl,
          fileName: file.name,
          sampleId: undefined,
        });
      };
      reader.readAsDataURL(file);
    },
    [mode, pushLog, runPictureReverse],
  );

  const handleSelectSampleImage = (sample: SampleReverseImage) => {
    setPictureDataUrl(sample.dataUrl);
    setPictureFileName(`${sample.id}.svg`);
    setPictureSampleId(sample.id);
    void runPictureReverse({
      dataUrl: sample.dataUrl,
      fileName: `${sample.id}.svg`,
      sampleId: sample.id,
    });
  };

  // Global clipboard paste support for images AND code when in picture or reverse mode
  useEffect(() => {
    if (mode === 'cover') return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleImageFile(file);
            return;
          }
        }
      }
      // If user is in Picture mode and pastes code on the page (outside an input/textarea), reverse the code into Picture + Workflow
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase();
      if (mode === 'picture' && activeTag !== 'input' && activeTag !== 'textarea') {
        const text = e.clipboardData?.getData('text/plain') || '';
        if (looksLikeCode(text)) {
          e.preventDefault();
          applyCodeToPictureAndWorkflow(text, true);
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [mode, handleImageFile, applyCodeToPictureAndWorkflow]);

  const generated = useMemo(() => (model ? generate(model, target) : null), [model, target]);

  const previewDoc = useMemo(() => {
    if (!model) {
      return mode === 'reverse' && reverse ? reverse.previewDoc : PLACEHOLDER_DOC;
    }
    if (model.kind === 'ui/hero') {
      return buildHeroPreviewDoc(model);
    }
    if (mode === 'reverse' && reverse && reverse.renderKind === 'html') {
      return reverse.previewDoc;
    }
    return generatePreviewDoc(model);
  }, [mode, reverse, model]);

  const workflowGraph = useMemo(() => {
    if (model) {
      return ensureWorkflow(model, generated?.filename);
    }
    return ensureWorkflow(
      {
        id: 'init',
        kind: 'system/pipeline',
        label: 'LinguaCode Translation Pipeline',
        props: [],
        warnings: [],
        updatedAt: Date.now(),
      },
      generated?.filename || 'component.tsx',
    );
  }, [model, generated]);

  const codeView = useMemo(() => {
    if (mode === 'reverse' && reverse) {
      if (!showReverseSource && generated) {
        return generated;
      }
      return { code: reverseCode, language: 'source', filename: 'pasted-code', lineMap: reverse.lineMap };
    }
    return generated;
  }, [mode, reverse, showReverseSource, generated, reverseCode]);

  const submitTranscript = () => {
    const text = transcript.trim();
    if (!text) return;
    setTranscript('');
    void handleUtterance(text);
  };

  const saveEngineConfig = (patch: Partial<EngineConfig>) => {
    const next = { ...engineConfig, ...patch };
    setEngineConfig(next);
    try {
      localStorage.setItem('ct.engine', JSON.stringify({ id: next.id, endpoint: next.endpoint, model: next.model }));
    } catch {
      /* ignore */
    }
  };

  // Google Login / Logout handlers
  const handleSignIn = async () => {
    setAuthBusy(true);
    try {
      const u = await loginWithGoogle();
      pushLog(`Logged in with Google: ${u.email}`);
    } catch (err) {
      pushLog(`Login failed: ${(err as Error).message}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAuthBusy(true);
    try {
      await logoutUser();
      pushLog('Signed out from Firebase.');
    } catch (err) {
      pushLog(`Sign out failed: ${(err as Error).message}`);
    } finally {
      setAuthBusy(false);
    }
  };

  // Save current workflow to Firebase
  const handleSaveToFirebase = async () => {
    if (!user) {
      pushLog('Sign in with Google to save workflows to Firebase.');
      return;
    }
    if (!model) {
      pushLog('No translation model to save. Speak or enter an idea first.');
      return;
    }
    try {
      await saveTranslationWorkflow(user.uid, model, target);
      pushLog(`Saved workflow "${model.label}" to your Firebase account!`);
    } catch (err) {
      pushLog(`Cloud save failed: ${(err as Error).message}`);
    }
  };

  // Load a workflow from Firebase
  const handleLoadWorkflow = (record: SavedTranslationRecord) => {
    try {
      const loadedModel = JSON.parse(record.modelData) as IntentModel;
      setModel(loadedModel);
      if (record.target) setTarget(record.target);
      setSelection(null);
      pushLog(`Loaded "${record.label}" from Firebase (${record.target || 'model'}).`);
    } catch (err) {
      pushLog(`Failed to load workflow: ${(err as Error).message}`);
    }
  };

  // Delete a workflow from Firebase
  const handleDeleteWorkflow = async (record: SavedTranslationRecord) => {
    if (!user) return;
    try {
      await deleteTranslationWorkflow(user.uid, record.id);
      pushLog(`Deleted "${record.label}" from Firebase.`);
    } catch (err) {
      pushLog(`Delete error: ${(err as Error).message}`);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div
          className="brand"
          onClick={() => setMode('cover')}
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          title="Return to LinguaCode cover page"
        >
          <span className="brand-mark">&lt;LC&gt;</span>
          <div>
            <h1>LinguaCode</h1>
            <p>vibe-translate-communicate</p>
          </div>
        </div>

        <div className="mode-toggle" role="tablist">
          <button type="button" className={mode === 'cover' ? 'on' : ''} onClick={() => setMode('cover')}>
            Cover
          </button>
          <button type="button" className={mode === 'speak' ? 'on' : ''} onClick={() => setMode('speak')}>
            Speak → Code
          </button>
          <button type="button" className={mode === 'reverse' ? 'on' : ''} onClick={() => setMode('reverse')}>
            Code → Visual
          </button>
          <button type="button" className={mode === 'picture' ? 'on' : ''} onClick={() => setMode('picture')}>
            Picture → Code
          </button>
        </div>

        {mode !== 'cover' ? (
          <label className="target-picker">
            <span>Target</span>
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value as TargetId);
                if (mode === 'reverse') {
                  setShowReverseSource(false);
                }
              }}
            >
              {TARGETS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="topbar-actions">
          {user ? (
            <div className="auth-box">
              <span className="user-chip">
                <span className="user-avatar">{user.displayName ? user.displayName[0].toUpperCase() : 'U'}</span>
                <span>{user.email || user.displayName}</span>
              </span>
              <button type="button" className="ghost" onClick={handleSaveToFirebase} disabled={!model}>
                Save to Cloud
              </button>
              <button type="button" className="ghost" onClick={handleSignOut} disabled={authBusy}>
                Sign Out
              </button>
            </div>
          ) : (
            <div className="auth-box">
              <button type="button" className="primary" onClick={handleSignIn} disabled={authBusy}>
                {authBusy ? 'Connecting…' : 'Sign in with Google'}
              </button>
            </div>
          )}

          <button type="button" className="ghost" onClick={() => setLinuxWidgetOpen(true)} title="Terminal Voice Companion for Linux">
            Linux widget
          </button>

          <button type="button" className="ghost founding-btn" onClick={() => setMembershipOpen(true)}>
            Founding seat · $10/qtr
          </button>

          <span className="backend-tag">{firebaseOnline ? 'Firebase: Active' : 'Firebase'}</span>

          <button type="button" className="ghost" onClick={undo} disabled={history.length === 0}>
            Undo
          </button>
          <span className={`status ${busy ? 'status-busy' : ''}`}>{busy ? 'translating…' : 'idle'}</span>
        </div>
      </header>

      {mode === 'cover' ? (
        <CoverLanding
          heroCode={DEFAULT_HERO_CODE}
          onLaunch={(initial) => setMode(initial || 'speak')}
          onLoadHeroIntoReverse={() => {
            setReverseCode(DEFAULT_HERO_CODE);
            setMode('reverse');
          }}
        />
      ) : (
        <main className="layout">
          <aside className="col-left">
          <section className="panel input-panel">
            <header className="panel-head">
              <h2>0 · Input</h2>
              <span className="chip">
                {mode === 'speak' ? 'voice / text' : mode === 'picture' ? 'picture → code' : 'source code'}
              </span>

              {mode === 'reverse' || mode === 'picture' ? (
                <div className="view-toggle" style={{ marginLeft: 'auto' }} role="tablist" aria-label="Reverse input type">
                  <button
                    type="button"
                    className={mode === 'reverse' ? 'on' : ''}
                    onClick={() => setMode('reverse')}
                  >
                    📄 Code → Visual
                  </button>
                  <button
                    type="button"
                    className={mode === 'picture' ? 'on' : ''}
                    onClick={() => setMode('picture')}
                  >
                    🖼️ Picture → Code
                  </button>
                </div>
              ) : null}
            </header>

            {mode === 'speak' ? (
              <>
                <div className="speak-row">
                  <MicButton
                    supported={speech.supported}
                    listening={speech.listening}
                    onStart={speech.start}
                    onStop={speech.stop}
                  />
                  <textarea
                    value={transcript}
                    placeholder='Say or type: "a wooden table, 48 inch top, 2 inch legs"'
                    onChange={(e) => setTranscript(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        submitTranscript();
                      }
                    }}
                  />
                  <button type="button" className="primary" onClick={submitTranscript}>
                    Translate
                  </button>
                </div>
                {speech.listening ? <p className="interim">{speech.interim || '…listening'}</p> : null}
                {speech.error ? <p className="error-line">{speech.error}</p> : null}
                <div className="quick-row">
                  {(isWorkflowTarget(target) ? WORKFLOW_PHRASES : QUICK_PHRASES).map((phrase) => (
                    <button
                      key={phrase}
                      type="button"
                      className="chip-button"
                      onClick={() => {
                        setTranscript(phrase);
                        void handleUtterance(phrase);
                      }}
                    >
                      {phrase}
                    </button>
                  ))}
                </div>
              </>
            ) : mode === 'picture' ? (
              <div className="picture-reverse-box">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImageFile(f);
                    e.target.value = '';
                  }}
                />

                {/* Drag & Drop / Upload / Paste Zone */}
                <div
                  className={`picture-dropzone ${dragActive ? 'drag-active' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleImageFile(f);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  <div className="picture-dropzone-icon">🖼️</div>
                  <div className="picture-dropzone-text">
                    <strong>Drop a picture here, click to browse, or press Ctrl+V to paste</strong>
                    <span>
                      Screenshots, UI mockups, workflow diagrams, or furniture blueprints — automatically reversed into
                      semantic properties, production code &amp; a workflow DAG.
                    </span>
                  </div>
                </div>

                {/* Current Picture Inspector + Metadata */}
                {pictureDataUrl ? (
                  <div className="picture-inspector-card">
                    <div className="picture-thumb-wrap">
                      <img src={pictureDataUrl} alt={pictureFileName || 'Uploaded preview'} className="picture-thumb" />
                    </div>
                    <div className="picture-meta-col">
                      <div className="picture-meta-header">
                        <strong className="picture-filename">{pictureFileName || 'uploaded-image.png'}</strong>
                        <span className="picture-provider-badge">
                          {pictureProvider === 'gemini-vision'
                            ? '✦ Gemini Vision'
                            : pictureProvider === 'openai-vision'
                            ? '✦ AI Vision'
                            : pictureProvider === 'code-to-picture'
                            ? '⚡ Code → Picture & DAG'
                            : '⚡ Local Vision Compiler'}
                        </span>
                      </div>
                      {pictureMeta ? (
                        <div className="picture-swatches">
                          <span className="picture-dim-pill">
                            {pictureMeta.width} × {pictureMeta.height}px
                          </span>
                          <span className="picture-swatch" title="Sampled Primary Accent Color">
                            <i style={{ background: pictureMeta.primaryColor }} />
                            {pictureMeta.primaryColor}
                          </span>
                          <span className="picture-swatch" title="Sampled Surface Background Color">
                            <i style={{ background: pictureMeta.backgroundColor }} />
                            {pictureMeta.backgroundColor}
                          </span>
                        </div>
                      ) : null}
                      <div className="picture-hint-row">
                        <input
                          type="text"
                          value={pictureHint}
                          onChange={(e) => setPictureHint(e.target.value)}
                          placeholder='Hint ("Pricing card", "DevOps pipeline") OR paste code here'
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void runPictureReverse();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="primary"
                          disabled={busy}
                          onClick={() => void runPictureReverse()}
                        >
                          {busy ? 'Reversing…' : looksLikeCode(pictureHint) ? 'Code → Picture & DAG' : 'Reverse → Code'}
                        </button>
                      </div>
                      {generated ? (
                        <div className="picture-actions-row">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              setReverseCode(generated.code);
                              setShowReverseSource(true);
                              setMode('reverse');
                              pushLog('Loaded reversed code into Code → Visual editor.');
                            }}
                          >
                            Open Reversed Code in Editor →
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {/* Direct Code -> Picture & Workflow box inside Picture mode */}
                <details className="engine-box code-to-pic-box">
                  <summary>💻 Or paste code here to generate Picture &amp; Workflow DAG</summary>
                  <div className="code-to-pic-body">
                    <textarea
                      className="code-input"
                      rows={4}
                      value={pictureCodeInput}
                      onChange={(e) => setPictureCodeInput(e.target.value)}
                      placeholder="Paste React TSX, HTML, Shell script, Workflow JSON, or Python here to synthesize its Picture & Workflow DAG..."
                      spellCheck={false}
                    />
                    <div className="quick-row">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          if (pictureCodeInput.trim()) {
                            applyCodeToPictureAndWorkflow(pictureCodeInput, true);
                          }
                        }}
                      >
                        ⚡ Render Code → Picture &amp; Workflow
                      </button>
                      <button
                        type="button"
                        className="chip-button"
                        onClick={() => {
                          const sampleShell = [
                            '#!/usr/bin/env sh',
                            '# [1] Trigger: On Git Push main',
                            ': # webhook: push main',
                            '# [2] Validator: Run Unit Tests & Lint',
                            'npm test',
                            '# [3] Transform: Build Production Bundle',
                            'npm run build',
                            '# [4] Action: Deploy to Production',
                            'git push origin main',
                          ].join('\n');
                          setPictureCodeInput(sampleShell);
                          applyCodeToPictureAndWorkflow(sampleShell, true);
                        }}
                      >
                        Load Sample Pipeline Code
                      </button>
                    </div>
                  </div>
                </details>

                {/* 1-Click Sample Pictures Gallery */}
                <div className="picture-samples-section">
                  <div className="picture-samples-label">Try a sample picture (1-click reverse to code + DAG):</div>
                  <div className="picture-samples-grid">
                    {SAMPLE_REVERSE_IMAGES.map((sample) => (
                      <button
                        key={sample.id}
                        type="button"
                        className={`picture-sample-card ${pictureSampleId === sample.id ? 'active' : ''}`}
                        onClick={() => handleSelectSampleImage(sample)}
                      >
                        <img src={sample.dataUrl} alt={sample.title} className="picture-sample-img" />
                        <div className="picture-sample-info">
                          <strong>{sample.title}</strong>
                          <span>{sample.subtitle}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <textarea
                  className="code-input"
                  value={reverseCode}
                  placeholder={'Paste React TSX, HTML, Shell Pipeline, Workflow JSON, or Python here.\nIt renders into a live Picture + editable Semantic Nodes + connected Workflow DAG.'}
                  onChange={(e) => {
                    setReverseCode(e.target.value);
                    setShowReverseSource(true);
                  }}
                  spellCheck={false}
                />
                <div className="quick-row">
                  <button
                    type="button"
                    className="chip-button"
                    onClick={() => {
                      setShowReverseSource(true);
                      setReverseCode(DEFAULT_HERO_CODE);
                    }}
                  >
                    Hero Component (TSX)
                  </button>
                  <button
                    type="button"
                    className="chip-button"
                    onClick={() => {
                      setShowReverseSource(true);
                      setReverseCode(
                        ['class Table:', '    top_width = 48', '    leg_height = 29', '    top_thickness = 1.5', '    leg_count = 4'].join('\n'),
                      );
                    }}
                  >
                    Table Class (Python)
                  </button>
                  <button
                    type="button"
                    className="chip-button"
                    onClick={() => {
                      setShowReverseSource(true);
                      setReverseCode(
                        [
                          '#!/usr/bin/env sh',
                          '# [1] Trigger: On Git Push main',
                          ': # webhook: push main',
                          '# [2] Validator: Run Unit Tests & Lint',
                          'npm test',
                          '# [3] Transform: Build Production Bundle',
                          'npm run build',
                          '# [4] Action: Deploy to Production',
                          'git push origin main',
                        ].join('\n'),
                      );
                    }}
                  >
                    DevOps Pipeline (Shell)
                  </button>
                  <button
                    type="button"
                    className="chip-button"
                    onClick={() => {
                      applyCodeToPictureAndWorkflow(reverseCode, true);
                      setMode('picture');
                    }}
                  >
                    🖼️ Send Code → Picture View
                  </button>
                  <button
                    type="button"
                    className="chip-button"
                    onClick={() => setReverseCode('')}
                  >
                    Clear Code
                  </button>
                </div>
              </>
            )}

            <details className="engine-box">
              <summary>Translator engine</summary>
              <div className="engine-grid">
                <label>
                  <span>Engine</span>
                  <select
                    value={engineConfig.id}
                    onChange={(e) => saveEngineConfig({ id: e.target.value as EngineConfig['id'] })}
                  >
                    <option value="local">Local rules (offline)</option>
                    <option value="remote">AI endpoint (Hugging Face / Gemini / OpenAI / Custom)</option>
                  </select>
                </label>
                {engineConfig.id === 'remote' ? (
                  <>
                    <label>
                      <span>Endpoint</span>
                      <input
                        type="text"
                        placeholder="https://..."
                        value={engineConfig.endpoint ?? ''}
                        onChange={(e) => saveEngineConfig({ endpoint: e.target.value })}
                      />
                    </label>
                    <label>
                      <span>Model</span>
                      <input
                        type="text"
                        placeholder="model ID"
                        value={engineConfig.model ?? ''}
                        onChange={(e) => saveEngineConfig({ model: e.target.value })}
                      />
                    </label>
                  </>
                ) : null}
              </div>
              <p className="hint">
                Deterministic rules run locally and offline. AI engine uses the session key or encrypted vault below to
                contact Google Gemini, OpenAI, or your custom endpoint. Output always passes through local semantic linting.
              </p>
            </details>
          </section>

          <VaultPanel
            secret={vaultSecret}
            isSessionOnly={isSessionOnly}
            serverMaskedKey={serverMaskedKey}
            onUnlock={(next, sessionOnly, sessionId) => {
              setVaultSecret(next);
              setIsSessionOnly(!!sessionOnly);
              if (sessionId) {
                setBackendSessionId(sessionId);
              }
              if (sessionOnly) {
                setServerMaskedKey('•••••••• (Backend Secured)');
              } else {
                setServerMaskedKey(null);
              }
              saveEngineConfig({
                id: 'remote',
                endpoint: next.endpoint,
                model: next.model,
                sessionId: sessionId || backendSessionId || undefined,
              });
              armAutoLock();
              pushLog(sessionOnly ? 'Backend in-memory API key activated (immune to scraping).' : 'Encrypted vault unlocked.');
            }}
            onLock={() => {
              setVaultSecret(null);
              setIsSessionOnly(false);
              setServerMaskedKey(null);
              clearSessionSecret();
              saveEngineConfig({ id: 'local' });
              pushLog('Session locked — API key removed from memory.');
            }}
            onForget={() => {
              setVaultSecret(null);
              setIsSessionOnly(false);
              setServerMaskedKey(null);
              setBackendSessionId(null);
              purgeAllKeys();
              saveEngineConfig({ id: 'local' });
              pushLog('API key deleted from backend RAM. Zero keys active.');
            }}
            onUsageChange={setUsage}
          />

          {user && savedWorkflows.length > 0 ? (
            <section className="panel cloud-panel">
              <header className="panel-head">
                <h2>Cloud Saved Workflows</h2>
                <span className="chip">{savedWorkflows.length} saved</span>
              </header>
              <div className="workflow-list">
                {savedWorkflows.map((item) => (
                  <div key={item.id} className="workflow-item">
                    <div>
                      <div className="workflow-title">{item.label}</div>
                      <div className="workflow-sub">
                        Target: {item.target || 'generic'} · {new Date(item.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="workflow-btns">
                      <button type="button" className="ghost" onClick={() => handleLoadWorkflow(item)}>
                        Load
                      </button>
                      <button type="button" className="ghost danger" onClick={() => handleDeleteWorkflow(item)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <p className="hint usage-line">
            {usage.requests} request{usage.requests === 1 ? '' : 's'} on key · ≈
            {Math.round((usage.promptChars + usage.outputChars) / 4).toLocaleString()} tokens · your key, your workflows.
          </p>

          <IntentPanel model={model} selection={selection} onSelect={setSelection} onChange={handlePropChange} />

          <section className="panel log-panel">
            <header className="panel-head">
              <h2>Translator log</h2>
            </header>
            <ul>
              {log.length === 0 ? <li className="empty">Interpretations, corrections, and cloud logs appear here.</li> : null}
              {log.map((entry) => (
                <li key={entry.id}>{entry.text}</li>
              ))}
            </ul>
          </section>
        </aside>

        <div className="col-right">
          {codeView ? (
            <CodePanel
              code={codeView.code}
              language={codeView.language}
              filename={codeView.filename}
              lineMap={codeView.lineMap}
              selection={selection}
              onSelect={setSelection}
              model={model}
              onApplyCode={(newCode) => applyCodeToPictureAndWorkflow(newCode, mode === 'picture')}
              viewToggle={
                mode === 'reverse' && reverse && generated
                  ? {
                      showingSource: showReverseSource,
                      targetLabel: target,
                      onToggle: setShowReverseSource,
                    }
                  : undefined
              }
            />
          ) : (
            <section className="panel">
              <header className="panel-head">
                <h2>3 · Generated code</h2>
              </header>
              <p className="empty">Code appears here once there is an intent model.</p>
            </section>
          )}

          <PreviewPanel
            doc={previewDoc}
            selection={selection}
            onSelect={setSelection}
            workflow={workflowGraph}
            showSafety={target === 'shell' || Boolean(model?.workflow)}
            onUpdateWorkflowNode={handleUpdateWorkflowNode}
            onAddWorkflowNode={handleAddWorkflowNode}
            autoSwitchToWorkflow={target === 'workflow' || model?.kind === WORKFLOW_KIND}
          />
        </div>
      </main>
      )}

      {linuxWidgetOpen ? <LinuxWidgetModal onClose={() => setLinuxWidgetOpen(false)} /> : null}

      {membershipOpen ? (
        <MembershipModal
          onClose={() => setMembershipOpen(false)}
          onSelectTier={(tier: MembershipTierId) =>
            pushLog(`${tier === 'founding' ? 'Founding Contributor ($10/quarter)' : tier} seat selected — checkout is not connected yet.`)
          }
        />
      ) : null}
    </div>
  );
}
