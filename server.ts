import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '5mb' }));

// In-memory backend session store for user API keys (never stored on client or disk)
interface ServerSession {
  apiKey: string;
  endpoint?: string;
  model?: string;
  createdAt: number;
}

const serverSessions = new Map<string, ServerSession>();

// Periodically clean up sessions idle for > 4 hours
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of serverSessions.entries()) {
    if (now - session.createdAt > 4 * 60 * 60 * 1000) {
      serverSessions.delete(id);
    }
  }
}, 30 * 60 * 1000);

// Initialize server-side Gemini if environment API key is present
const serverGemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

/* ---------------------------------- API Routes ---------------------------------- */

// 1. Vault status (does not leak the actual API key to the browser)
app.get('/api/vault/status', (req: Request, res: Response) => {
  const sessionId = (req.headers['x-session-id'] as string) || '';
  const session = serverSessions.get(sessionId);

  res.json({
    hasServerDefaultKey: Boolean(serverGemini),
    hasSessionKey: Boolean(session?.apiKey),
    endpoint: session?.endpoint || (serverGemini ? 'server-gemini' : ''),
    model: session?.model || (serverGemini ? 'gemini-3.8-flash' : ''),
    maskedKey: session?.apiKey
      ? `${session.apiKey.slice(0, 3)}••••••••${session.apiKey.slice(-4)}`
      : serverGemini
      ? '•••••••• (Server Environment)'
      : null,
  });
});

// 2. Set API key into backend memory session only (no browser persistence)
app.post('/api/vault/session', (req: Request, res: Response) => {
  const { apiKey, endpoint, model } = req.body;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: 'Valid apiKey string is required' });
  }

  const sessionId = (req.headers['x-session-id'] as string) || `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  serverSessions.set(sessionId, {
    apiKey: apiKey.trim(),
    endpoint: (endpoint || '').trim(),
    model: (model || '').trim(),
    createdAt: Date.now(),
  });

  res.json({
    success: true,
    sessionId,
    message: 'API key securely registered in backend RAM only. Not stored in browser storage.',
    maskedKey: `${apiKey.trim().slice(0, 3)}••••••••${apiKey.trim().slice(-4)}`,
  });
});

// 3. Clear API key from backend memory
app.post('/api/vault/clear', (req: Request, res: Response) => {
  const sessionId = (req.headers['x-session-id'] as string) || '';
  if (sessionId) {
    serverSessions.delete(sessionId);
  }
  res.json({ success: true, message: 'Session key destroyed from backend RAM.' });
});

// System prompts for semantic layer
const SYSTEM_PROMPT = `You are the semantic layer of a voice-to-code translator.
Convert the user's utterance into an IntentModel JSON object. Never return code.
Schema:
{
  "kind": "furniture/table | furniture/chair | ui/button | ui/card | ui/form | generic/object",
  "label": "short human name",
  "props": [{ "key": "dot.separated", "label": "Human label", "value": number|string|boolean, "unit": "in|px|...", "confidence": 0..1, "source": "phrase from the user", "options": ["..."] }]
}
Rules:
- Canonical units: furniture dimensions in inches, UI dimensions in px.
- Keep the user's exact numbers. Do not "fix" implausible values — return them and describe the risk in "notes".
- If the message is a correction to an existing model (given below), return the FULL updated model and change only the targeted node.
- Also return {"notes": ["..."]} listing ambiguity or ergonomic risks you noticed.
Return ONLY JSON.`;

const WORKFLOW_PROMPT = `You are the semantic layer of a voice-to-workflow compiler.
Convert the user's utterance into a workflow DAG. Never return prose.
Schema:
{
  "label": "short pipeline name",
  "nodes": [{ "id": "step.1", "type": "trigger | validator | transform | action", "label": "human step name",
              "command": "single POSIX sh command (omit for triggers)", "detail": "cron expression, event name, etc.",
              "destination": "terminal | db | webhook | file" }],
  "edges": [{ "from": "step.1", "to": "step.2" }],
  "notes": ["risks or ambiguity"]
}
Rules:
- Start with exactly one trigger (mic, event, cron). Put a validator before any destructive step.
- Prefer portable POSIX commands. Never invent credentials; use $ENV_VARS.
- If an existing workflow is given, return the FULL updated graph and change only what the user asked.
Return ONLY JSON.`;

// 4. Server-Side Translate Route (The key never touches browser inspection)
app.post('/api/translate', async (req: Request, res: Response) => {
  try {
    const { text, current, selection, target, apiKey: ephemeralKey, endpoint: customEndpoint, model: customModel } = req.body;
    const sessionId = (req.headers['x-session-id'] as string) || '';
    const session = serverSessions.get(sessionId);

    // Resolve key: 1. Ephemeral header/body key, 2. Backend session key, 3. Server default Gemini key
    const effectiveKey = ephemeralKey || session?.apiKey || process.env.GEMINI_API_KEY || '';
    const effectiveEndpoint = customEndpoint || session?.endpoint || '';
    const effectiveModel = customModel || session?.model || '';

    const isWorkflow = target === 'shell' || target === 'dag' || Boolean(current?.workflow);
    const systemPrompt = isWorkflow ? WORKFLOW_PROMPT : SYSTEM_PROMPT;

    const isGoogleEndpoint = !effectiveEndpoint || effectiveEndpoint.includes('googleapis.com');
    const isGeminiKey = effectiveKey.startsWith('AIza') || (!effectiveKey && Boolean(serverGemini));

    // A) Native Google Gemini SDK route
    if (isGeminiKey && isGoogleEndpoint) {
      const activeGenAI = effectiveKey.startsWith('AIza')
        ? new GoogleGenAI({
            apiKey: effectiveKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          })
        : serverGemini;

      if (!activeGenAI) {
        return res.status(401).json({ error: 'No active AI key available on server.' });
      }

      const modelName = effectiveModel && !effectiveModel.includes('/') ? effectiveModel : 'gemini-2.5-flash';
      const response = await activeGenAI.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${systemPrompt}\n\nUser Input: ${JSON.stringify({
                  utterance: text,
                  selection,
                  existingModel: current
                    ? { kind: current.kind, label: current.label, props: current.props, workflow: current.workflow }
                    : null,
                })}`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0,
        },
      });

      const raw = response.text || '{}';
      return res.json({ raw, provider: 'gemini' });
    }

    // B) Standard OpenAI / OpenRouter / HuggingFace / Custom endpoint proxy from server
    if (!effectiveKey) {
      return res.status(401).json({
        error: 'No API key configured. Provide an API key to the backend session in the key vault.',
      });
    }

    const endpoint = (effectiveEndpoint || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${effectiveKey}`,
    };

    if (/(^|\/\/)(?:[\w-]+\.)?openrouter\.ai\b/.test(endpoint)) {
      headers['HTTP-Referer'] = 'https://linguacode.app';
      headers['X-Title'] = 'LinguaCode';
    }

    const isHuggingFace = /(^|\/\/)(router|api-inference)\.huggingface\.co\b/.test(endpoint);
    const bodyPayload: Record<string, unknown> = {
      model: effectiveModel || (isHuggingFace ? 'Qwen/Qwen2.5-Coder-32B-Instruct' : 'gpt-4o-mini'),
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: JSON.stringify({
            utterance: text,
            selection,
            existingModel: current
              ? { kind: current.kind, label: current.label, props: current.props, workflow: current.workflow }
              : null,
          }),
        },
      ],
    };

    if (isHuggingFace) {
      bodyPayload.max_tokens = 2048;
    } else {
      bodyPayload.response_format = { type: 'json_object' };
    }

    const upstream = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({
        error: `Upstream AI provider error (${upstream.status}): ${errText.slice(0, 300)}`,
      });
    }

    const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    return res.json({ raw, provider: isHuggingFace ? 'huggingface' : 'openai-compatible' });
  } catch (err) {
    console.error('Server /api/translate error:', err);
    return res.status(500).json({ error: (err as Error).message });
  }
});

/* ---------------------------------- Vite Integration ---------------------------------- */

async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LinguaCode server running on http://0.0.0.0:${PORT} (dev: ${!isProduction})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
