#!/usr/bin/env bash
# LinguaCode Terminal Voice Companion — Linux installer.
#
#   curl -fsSL https://raw.githubusercontent.com/chrisfbaileycb-arch/vibe-translate-communicate-/main/scripts/install-widget.sh | bash
#
# Installs into your home directory only (no sudo):
#   ~/.local/share/linguacode/linguacode-voice.mjs   the CLI (one file, Node >= 18, no npm packages)
#   ~/.local/bin/linguacode-voice                    launcher
#   ~/.local/share/applications/linguacode-voice.desktop   app-menu entry / hotkey target
#
# Options:  --uninstall     remove everything above (keeps ~/.config/linguacode unless you run `linguacode-voice key clear`)
#           --from DIR      install from a local checkout's widget/release instead of downloading
# Env:      LINGUACODE_REF  git ref to install from (default: main)
#
# Everything runs inside main(), so a truncated download can never execute half a script.

set -euo pipefail

main() {
  local repo="${LINGUACODE_REPO:-chrisfbaileycb-arch/vibe-translate-communicate-}"
  local ref="${LINGUACODE_REF:-main}"
  local base="https://raw.githubusercontent.com/${repo}/${ref}/widget/release"
  local share="${XDG_DATA_HOME:-$HOME/.local/share}"
  local dest="$share/linguacode"
  local bin="$HOME/.local/bin"
  local desktop="$share/applications/linguacode-voice.desktop"
  local from=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --uninstall)
        rm -f "$bin/linguacode-voice" "$desktop" "$dest/linguacode-voice.mjs" "$dest/SHA256SUMS"
        rmdir "$dest" 2>/dev/null || true
        say "Uninstalled. Your settings in ~/.config/linguacode were kept — run 'linguacode-voice key clear' first next time to destroy the key."
        return 0
        ;;
      --from) from="${2:?--from needs a directory}"; shift ;;
      *) die "Unknown option: $1" ;;
    esac
    shift
  done

  [ "$(uname -s)" = "Linux" ] || die "This installer is for Linux. On other systems use the Chrome extension."

  command -v node >/dev/null 2>&1 || die "Node.js 18+ is required (e.g. 'sudo apt install nodejs' or https://nodejs.org)."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 18 ] || die "Node.js 18+ is required — found $(node -v)."

  mkdir -p "$dest" "$bin" "$(dirname "$desktop")"
  LC_TMP="$(mktemp -d)"  # global: the EXIT trap runs after main's locals are gone
  trap 'rm -rf "${LC_TMP:-}"' EXIT
  local tmp="$LC_TMP"

  if [ -n "$from" ]; then
    cp "$from/linguacode-voice.mjs" "$from/SHA256SUMS" "$tmp/"
  else
    say "Downloading from ${repo}@${ref}…"
    curl -fsSL "$base/linguacode-voice.mjs" -o "$tmp/linguacode-voice.mjs"
    curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"
  fi

  # Integrity check: catches truncated or corrupted downloads.
  (cd "$tmp" && sha256sum --check --quiet SHA256SUMS) || die "Checksum mismatch — download corrupted. Nothing was installed."

  install -m 0755 "$tmp/linguacode-voice.mjs" "$dest/linguacode-voice.mjs"
  install -m 0644 "$tmp/SHA256SUMS" "$dest/SHA256SUMS"

  cat > "$bin/linguacode-voice" <<EOF
#!/bin/sh
exec node "$dest/linguacode-voice.mjs" "\$@"
EOF
  chmod 0755 "$bin/linguacode-voice"

  cat > "$desktop" <<EOF
[Desktop Entry]
Type=Application
Name=LinguaCode Voice → Shell
Comment=Speak a task, get one verified POSIX command on your clipboard
Exec=$bin/linguacode-voice --notify
Icon=utilities-terminal
Terminal=false
Categories=Development;Utility;
EOF

  say "Installed linguacode-voice $(node "$dest/linguacode-voice.mjs" --version)."
  echo

  # Optional pieces: report, never install system packages on the user's behalf.
  local missing=()
  has_any pw-record parecord arecord ffmpeg || missing+=("audio recorder: pipewire / pulseaudio-utils / alsa-utils / ffmpeg")
  if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    has_any wl-copy || missing+=("clipboard: wl-clipboard")
  else
    has_any xclip xsel || missing+=("clipboard: xclip or xsel")
  fi
  has_any notify-send || missing+=("notifications (for --notify): libnotify-bin")
  has_any whisper-cli whisper-cpp || missing+=("offline speech-to-text (optional): whisper.cpp — or set HF_TOKEN for Hugging Face Whisper")
  if [ ${#missing[@]} -gt 0 ]; then
    say "Optional tools not found:"
    printf '  - %s\n' "${missing[@]}"
    echo
  fi

  case ":$PATH:" in
    *":$bin:"*) ;;
    *) say "Add ~/.local/bin to your PATH:  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc" ;;
  esac

  cat <<'EOF'
Next steps
  linguacode-voice "find log files bigger than 100MB"     try it (works offline on local rules)
  linguacode-voice key set                                  optional: your OpenRouter / OpenAI-compatible key
  eval "$(linguacode-voice --shell-init bash)"              Alt+S speaks onto your prompt line (add to ~/.bashrc; zsh too)
  Desktop hotkey: bind  linguacode-voice --notify  in Settings → Keyboard → Custom Shortcuts

Destructive commands (rm -rf, DROP, kill, --force …) are never copied without an explicit yes.
EOF
}

say() { printf '\033[1;36mlinguacode:\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mlinguacode:\033[0m %s\n' "$*" >&2; exit 1; }
has_any() { local c; for c in "$@"; do command -v "$c" >/dev/null 2>&1 && return 0; done; return 1; }

main "$@"
