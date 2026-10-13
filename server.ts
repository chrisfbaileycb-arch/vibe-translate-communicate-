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

app.use(express.json({ limit: '15mb' }));

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
const geminiKey = process.env.GEMINI_API_KEY || (process.env.API_KEY?.startsWith('AIza') ? process.env.API_KEY : '');
const serverGemini = geminiKey
  ? new GoogleGenAI({
      apiKey: geminiKey,
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
  const hasServerDefaultKey = Boolean(process.env.API_KEY || process.env.GEMINI_API_KEY);

  res.json({
    hasServerDefaultKey,
    hasSessionKey: Boolean(session?.apiKey),
    endpoint: session?.endpoint || (serverGemini ? 'server-gemini' : (process.env.API_KEY ? 'https://openrouter.ai/api/v1' : '')),
    model: session?.model || (serverGemini ? 'gemini-3.8-flash' : 'gpt-4o-mini'),
    maskedKey: session?.apiKey
      ? `${session.apiKey.slice(0, 3)}••••••••${session.apiKey.slice(-4)}`
      : hasServerDefaultKey
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

    // Resolve key: 1. Ephemeral header/body key, 2. Backend session key, 3. Server process.env.API_KEY / GEMINI_API_KEY
    const effectiveKey = ephemeralKey || session?.apiKey || process.env.API_KEY || process.env.GEMINI_API_KEY || '';
    const effectiveEndpoint = customEndpoint || session?.endpoint || '';
    const effectiveModel = customModel || session?.model || '';

    const isWorkflow = target === 'shell' || target === 'dag' || Boolean(current?.workflow);
    const systemPrompt = isWorkflow ? WORKFLOW_PROMPT : SYSTEM_PROMPT;

    const isGeminiKey = effectiveKey.startsWith('AIza') || (!effectiveKey && Boolean(serverGemini));

    // A) Native Google Gemini SDK route
    if (isGeminiKey) {
      const activeGenAI = effectiveKey.startsWith('AIza')
        ? new GoogleGenAI({
            apiKey: effectiveKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          })
        : serverGemini;

      if (!activeGenAI) {
        return res.status(401).json({ error: 'No active AI key available on server.' });
      }

      const modelName =
        effectiveModel && effectiveModel.startsWith('gemini-') ? effectiveModel : 'gemini-3.8-flash';
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

const VISION_REVERSE_PROMPT = `You are the reverse-vision compiler of LinguaCode.
Analyze the provided picture (screenshot, UI mockup, diagram, or physical object) and reverse-engineer it into:
1. A structured semantic IntentModel ("kind", "label", "props").
2. Clean, self-contained React/Tailwind TSX code ("code") that reproduces the picture and tags key elements with data-node-id="<prop.key>".
3. A reverse-engineering or architectural workflow DAG ("workflow") with 4 to 6 nodes showing the reverse pipeline or detected system flow.

Return ONLY valid JSON matching this schema:
{
  "kind": "ui/card | ui/hero | ui/dashboard | ui/button | furniture/table | workflow/pipeline | generic/object",
  "label": "PascalCase component or object name (e.g. PricingCard, AnalyticsDashboard, StandingDesk)",
  "summary": "1-sentence description of what was reverse-engineered from the picture",
  "props": [
    {
      "key": "title",
      "label": "Heading Text",
      "value": "Extracted heading or title",
      "unit": "",
      "confidence": 0.95,
      "source": "image OCR / header"
    },
    {
      "key": "subtitle",
      "label": "Subtitle / Description",
      "value": "Extracted subtitle or details",
      "unit": "",
      "confidence": 0.9,
      "source": "image body text"
    },
    {
      "key": "badge",
      "label": "Eyebrow / Badge",
      "value": "Extracted badge or status tag",
      "unit": "",
      "confidence": 0.9,
      "source": "image badge"
    },
    {
      "key": "ctaLabel",
      "label": "Primary Action Label",
      "value": "Extracted button text",
      "unit": "",
      "confidence": 0.92,
      "source": "image CTA button"
    },
    {
      "key": "primaryColor",
      "label": "Primary Accent Color",
      "value": "#38bdf8",
      "unit": "",
      "confidence": 0.9,
      "source": "dominant accent hex"
    },
    {
      "key": "backgroundColor",
      "label": "Surface Background",
      "value": "#0f172a",
      "unit": "",
      "confidence": 0.9,
      "source": "surface hex"
    },
    {
      "key": "width",
      "label": "Container Width",
      "value": 420,
      "unit": "px",
      "confidence": 0.85,
      "source": "estimated width"
    },
    {
      "key": "radius",
      "label": "Corner Radius",
      "value": 16,
      "unit": "px",
      "confidence": 0.88,
      "source": "border radius"
    }
  ],
  "workflow": {
    "nodes": [
      { "id": "rev.ingest", "type": "trigger", "label": "Picture Frame Ingest", "detail": "Vision buffer + color histogram" },
      { "id": "rev.ocr", "type": "transform", "label": "Layout & Typography Extraction", "detail": "Extract hierarchy, text & spacing" },
      { "id": "rev.lint", "type": "validator", "label": "Ergonomic & Contrast Validator", "detail": "Verify tap targets & WCAG contrast", "command": "test 0 -eq 0" },
      { "id": "rev.emit", "type": "action", "label": "Emit Bound Component Code", "destination": "file", "command": "cat > ReversedComponent.tsx <<'EOF'" }
    ],
    "edges": [
      { "from": "rev.ingest", "to": "rev.ocr" },
      { "from": "rev.ocr", "to": "rev.lint" },
      { "from": "rev.lint", "to": "rev.emit" }
    ]
  },
  "notes": ["Any layout, contrast, or ergonomic observations"]
}
Rules:
- If the picture is furniture/table/desk, use kind "furniture/table" and include canonical inch props: "top.width", "top.length", "top.thickness", "legs.height", "legs.count", "material".
- If the picture is a flowchart or pipeline diagram, use kind "workflow/pipeline" and populate "workflow.nodes" and "workflow.edges" with the actual steps shown in the diagram.
- Otherwise, use "ui/card", "ui/hero", or "ui/dashboard" and include accurate text, hex colors, and pixel dimensions from the image.
- Return ONLY JSON.`;

// 5. Server-Side Reverse Image Route (Picture -> Semantic Model + Code + Workflow)
app.post('/api/reverse-image', async (req: Request, res: Response) => {
  try {
    const {
      imageBase64,
      mimeType,
      hint,
      target,
      apiKey: ephemeralKey,
      endpoint: customEndpoint,
      model: customModel,
    } = req.body;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    const sessionId = (req.headers['x-session-id'] as string) || '';
    const session = serverSessions.get(sessionId);

    const effectiveKey = ephemeralKey || session?.apiKey || process.env.API_KEY || process.env.GEMINI_API_KEY || '';
    const effectiveEndpoint = customEndpoint || session?.endpoint || '';
    const effectiveModel = customModel || session?.model || '';

    // Parse data URL if passed as data:image/...;base64,xxxx or data:image/svg+xml;utf8,xxxx
    let cleanBase64 = imageBase64.trim();
    let resolvedMimeType = mimeType || 'image/png';
    let svgTextPayload = '';

    const dataUrlMatch = cleanBase64.match(/^data:([^;]+);base64,(.+)$/s);
    const svgUtf8Match = cleanBase64.match(/^data:image\/svg\+xml;utf8,(.+)$/s);
    if (dataUrlMatch) {
      resolvedMimeType = dataUrlMatch[1];
      cleanBase64 = dataUrlMatch[2];
      if (resolvedMimeType === 'image/svg+xml') {
        try {
          svgTextPayload = Buffer.from(cleanBase64, 'base64').toString('utf-8');
        } catch {
          /* ignore */
        }
      }
    } else if (svgUtf8Match) {
      resolvedMimeType = 'image/svg+xml';
      svgTextPayload = decodeURIComponent(svgUtf8Match[1]);
    }

    const isGeminiKey = effectiveKey.startsWith('AIza') || (!effectiveKey && Boolean(serverGemini));

    const userPromptText = `${VISION_REVERSE_PROMPT}\n\nTarget output format: ${target || 'nextjs'}${
      hint ? `\nUser instructions / hint: ${hint}` : ''
    }${svgTextPayload ? `\n\nSVG Vector Source of the Picture:\n${svgTextPayload}` : ''}`;

    // A) Native Google Gemini Vision route
    if (isGeminiKey) {
      const activeGenAI = effectiveKey.startsWith('AIza')
        ? new GoogleGenAI({
            apiKey: effectiveKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          })
        : serverGemini;

      if (!activeGenAI) {
        return res.status(401).json({ error: 'No active AI key available on server.' });
      }

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (resolvedMimeType !== 'image/svg+xml' && cleanBase64) {
        parts.push({
          inlineData: {
            mimeType: resolvedMimeType,
            data: cleanBase64,
          },
        });
      }
      parts.push({ text: userPromptText });

      const response = await activeGenAI.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const raw = response.text || '{}';
      return res.json({ raw, provider: 'gemini-vision' });
    }

    // B) OpenAI / OpenRouter Multimodal Vision route
    if (!effectiveKey) {
      return res.status(401).json({
        error: 'No API key configured for remote vision. Using local image inspector.',
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

    // Ensure vision-capable model (fallback to gpt-4o-mini if a text-only coder model is selected)
    const visionModel =
      effectiveModel && !/coder|deepseek-chat/i.test(effectiveModel) ? effectiveModel : 'gpt-4o-mini';

    const bodyPayload: Record<string, unknown> = {
      model: visionModel,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: userPromptText },
            {
              type: 'image_url',
              image_url: {
                url: `data:${resolvedMimeType};base64,${cleanBase64}`,
              },
            },
          ],
        },
      ],
    };

    const upstream = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({
        error: `Upstream Vision AI error (${upstream.status}): ${errText.slice(0, 300)}`,
      });
    }

    const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    return res.json({ raw, provider: 'openai-vision' });
  } catch (err) {
    console.error('Server /api/reverse-image error:', err);
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
