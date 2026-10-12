# Code Translator

A progressive web app for **speaking code into existence — and seeing what the machine understood before you trust it**.

Speech (or text) → **semantic model** → **code** → **instant visual proof**, with two-way binding between the
render and the source. Paste code back in and it renders too. Code is treated as a *communication medium*
with the same ambiguity problem as spoken language — so interpretation is always made visible and
correctable before it hardens into syntax.

## Why the middle layer exists

> "Build me a table."  →  a 2-inch tall slab is still a table.

A pure speech→code translator produces code that compiles and is useless. This app inserts two extra
layers so the human and the machine can *argue cheaply*:

```
[ spoken intent ]  "a wooden table, 48 inch top, 2 inch legs"
        │
        ▼
 1. SEMANTIC LAYER   IntentModel: every property keeps the phrase it came from,
        │            a confidence score, and a nodeId.
        ▼
 2. DOMAIN LINTER    Constraints for the domain: 2" legs are flagged as an ergonomic
        │            error with a concrete suggestion ("28–30in desk height").
        ▼
 3. GENERATORS       Next.js / HTML / Python / TypeScript / JSON — each line tagged
        │            with the nodeId it came from.
        ▼
 4. VISUAL VERIFIER  Instant scratch render. Click the squat legs → the exact code
                     lines light up. Say "make the legs 29 inches" → only that node
                     changes, code rewrites, render stretches.
```

## The loop, end to end

1. **Speak** (Web Speech API) or type: *“Build a wooden table, 54 inch top, 2 inch legs.”*
2. The **semantic panel** shows what was understood — each property with its source phrase and
   confidence. The **domain constraints** block flags `legs.height = 2"` as an error.
3. **Point at the mistake**: click the legs in the render (or the property card) — the generated
   code's exact lines highlight.
4. **Correct precisely**: *“Make the legs 29 inches”* mutates one node. Nothing else is
   re-translated, so nothing else breaks. `Undo` reverts a step.
5. **Switch targets** (Next.js/TSX, HTML+CSS, Python, TypeScript contract, JSON) and the same
   model regenerates with the same node→line mapping.
6. **Reverse**: switch to *Code → Visual*, paste HTML/JSX/Python — it renders (HTML exactly) or
   sketches the shape the dimensions describe, and the extracted properties become editable nodes.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # 32 logic checks: parsing, corrections, linter, generators, reverse path
npm run build      # type check + production bundle -> dist/
npm run preview    # serve the production build (installable PWA)
```

PWA: `manifest.webmanifest` + service worker cache the app shell, so it installs to the
home screen and opens offline. Mic needs Chrome/Edge (Web Speech API); typing always works.

## Translator engines

| Engine | What it does |
| --- | --- |
| **Local rules** (default) | Deterministic offline parser + domain constraints. Instant, predictable, private. |
| **AI endpoint** | Any OpenAI-compatible `/chat/completions` endpoint (URL + key + model). The model returns an `IntentModel` in JSON — never code — and its output is still run through the **local** constraint linter, so an AI cannot skip the sanity layer. |

## Bring your own key — the product is the loop, not the token spend

Anyone can sell access to a model. This product sells the **translation loop** and lets the user
bring the credential:

- The key is encrypted **before** it touches storage: PBKDF2-SHA256 (600k iterations) → AES-GCM-256,
  via the browser's WebCrypto. The passphrase is never stored, never transmitted, never recoverable.
- The plaintext key exists **in memory only** while the vault is unlocked, and is sent **only** to the
  endpoint its owner configures. There is no backend in this app, so the key cannot leak through the
  product — it never sees it.
- The vault auto-locks after 15 minutes idle and locks on demand.
- **Export / import an encrypted vault file** — portable between devices, unreadable without the
  passphrase (AES-GCM authentication rejects tampering).
- A **usage meter** (requests, ≈ tokens) shows the owner exactly what their own key is spending,
  so "run it all night" is their decision with their bill visible.
- Replace-key and change-passphrase flows re-encrypt; "Forget vault" wipes the device copy.

Threat model, honestly: this protects the key at rest (shared devices, synced browser profiles,
backups, shoulder-surfers reading localStorage). It does not protect against a compromised browser
or malicious injected script while the vault is unlocked — no client-side scheme can. Deployment
must be over HTTPS (also required for WebCrypto and for installing the PWA).

Selling the service means shipping this app; the customer's key stays the customer's. That is the
whole business model.

## Project layout

```
src/lib/types.ts      IntentModel, props with nodeId + source phrase + confidence
src/lib/parse.ts      utterance -> model, and targeted corrections ("make the legs 29in")
src/lib/lint.ts       domain constraint engine (table ergonomics, tap targets, contrast…)
src/lib/generate.ts   model -> Next.js / HTML / Python / TypeScript / JSON, with line maps
src/lib/reverse.ts    code -> model + visual, keeping source line numbers
src/lib/engine.ts     local + remote translators behind one interface
src/lib/vault.ts      BYOK vault: PBKDF2 → AES-GCM, export/import, usage meter
src/lib/useSpeech.ts  Web Speech API hook
src/components/       IntentPanel · CodePanel · PreviewPanel · MicButton · VaultPanel
src/lib/smoke.test.ts node --experimental-strip-types, no test framework needed
```

## Design notes worth keeping

- **Never re-translate what you can patch.** Corrections address a `nodeId`, not a prompt.
- **The visual and the syntax share identity.** Every rendered element carries `data-node-id`;
  every generated line is tagged with the node it came from. Clicking either side selects both.
- **Constraints are domain knowledge, not AI.** 28–30" desk height, 44px tap targets, 4.5:1
  contrast — cheap rules that catch the failures language models happily produce.
- **The scratch render is disposable.** It exists to be argued with, not to be admired.

## Terminal Voice Companion (Chrome extension)

`extension/` holds a Manifest V3 companion: press **Alt+S** (or **Ctrl+Shift+Space**) on any page,
say what you want, and get **one** POSIX command plus a one-line safety note.

```bash
npm run build:extension   # -> dist-extension/
```

Load it at `chrome://extensions` → Developer mode → **Load unpacked** → `dist-extension/`.

- **Same engine as the studio.** `src/lib/shell.ts` turns the utterance into a command with the local
  workflow rules, or with your BYOK endpoint (Hugging Face router, Gemini, OpenAI…). Either way
  `safety.ts` re-checks the result locally — an LLM cannot talk its way past the safety note.
- **Clipboard.** Safe and caution commands are copied immediately — press `Ctrl+Shift+V` in your
  terminal. Destructive ones (`rm -rf`, `DROP`, `kill`, `--force` …) are **never** auto-copied;
  you press "Copy anyway".
- **Web terminals.** On xterm.js terminals (VS Code Web, Cloud Shell, Gitpod, ttyd…) "Insert into
  terminal" pastes into the prompt **without a newline** — you still press Enter.
- **Speech.** Browser speech recognition by default, or Hugging Face Whisper with your `hf_` token.
  The overlay runs inside the page, so each site asks for microphone access once.
- **Keys** live in `chrome.storage.session` (memory-only, unreadable by web pages) or encrypted
  with your passphrase using the studio's vault format. All network calls happen in the background
  worker, never in the page.

Limits: Chrome only fires extension shortcuts while a Chrome window is focused, and it won't inject
into `chrome://` pages or the Web Store — there the shortcut opens the options page's "Try it" box.
Terminals inside cross-origin iframes aren't reachable for insertion; the clipboard path still works.

## Linux Terminal Voice Companion

A native CLI for when the browser sandbox is in the way. One install line, everything in `~/.local`, no sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/chrisfbaileycb-arch/vibe-translate-communicate-/main/scripts/install-widget.sh | bash
```

```bash
linguacode-voice "find log files bigger than 100MB"   # command on stdout, safety line on stderr, copied
linguacode-voice                                       # speak; Enter stops recording
eval "$(linguacode-voice --shell-init bash)"           # Alt+S speaks onto the prompt line (bash/zsh) — never auto-runs
linguacode-voice --notify                              # bind to a desktop hotkey
linguacode-voice key set | key clear | key status      # OpenRouter by default; keyring or 0600 file
```

- `widget/src/cli.ts` reuses `src/lib/shell.ts` + `safety.ts`, so the studio, the Chrome extension and the CLI
  agree on what is destructive. `npm run build:widget` bundles it into **one** Node 18+ file,
  `widget/release/linguacode-voice.mjs`, plus `SHA256SUMS`. That release file is committed — the installer
  downloads it straight from the repo — so **rebuild and commit it whenever `shell.ts`, `safety.ts` or `workflow.ts` change.**
- Audio: PipeWire / PulseAudio / ALSA / ffmpeg. Speech-to-text: whisper.cpp (`whisper-cli` +
  `LINGUACODE_WHISPER_MODEL`) offline, or `HF_TOKEN` for Hugging Face Whisper; otherwise it asks you to type.
- Clipboard: `wl-copy` (Wayland), `xclip` / `xsel` (X11). Destructive commands need an explicit yes.

## Roadmap

- Real AST parsing for reverse mode (acorn/ts-morph) instead of heuristic extraction.
- More domain packs: chairs, rooms, dashboards, forms — each with its own constraint set.
- Spatial selection in 3D (drag a dimension on the render, hear the code change).
- Offline Whisper-class transcription so voice works without the browser's speech service.
- Drop an open-source repo in `references/` and let the semantic layer read its conventions
  before generating.

## Notes on the "translation" framing

The app does not encrypt, obfuscate or hide anything. It treats code as a *language with
consequences*: the same sentence can mean a hundred shapes, so the meaning is rendered, checked
against domain common sense, and pinned to the exact lines that produced it. That is what makes
the human↔AI loop fast — you correct the interpretation, not the whole output.
