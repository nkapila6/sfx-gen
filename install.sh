#!/usr/bin/env bash
# sfx-gen installer: prebuilt sa3.cpp, the model weights, and the Claude Code plugin.
# Nothing is compiled on your machine.
#
#   curl -fsSL https://raw.githubusercontent.com/nkapila6/sfx-gen/main/install.sh | bash
#
# Env overrides: SA3_VERSION, SA3_HOME, SFX_MODEL (small-sfx | small-music | medium), SFX_ENCODING.

set -euo pipefail

SA3_VERSION="${SA3_VERSION:-v0.1.3}"
SA3_HOME="${SA3_HOME:-$HOME/.claude/sa3}"
SFX_MODEL="${SFX_MODEL:-small-sfx}"
SFX_ENCODING="${SFX_ENCODING:-q5_k_m}"
REPO="nkapila6/sfx-gen"
# macOS comes from sa3.cpp's own releases; upstream ships no Linux build, so we host one
MAC_RELEASES="https://github.com/betweentwomidnights/sa3.cpp/releases/download/$SA3_VERSION"
LINUX_RELEASES="https://github.com/$REPO/releases/download/sa3-$SA3_VERSION-linux"

green=$'\033[32m' red=$'\033[31m' dim=$'\033[2m' off=$'\033[0m'
say() { printf '%s❯%s %s\n' "$green" "$off" "$*"; }
note() { printf '  %s%s%s\n' "$dim" "$*" "$off"; }
die() { printf '%s✗%s %s\n' "$red" "$off" "$*" >&2; exit 1; }

# Wrapped in main so a half-downloaded script never runs.
main() {
  local os pkg url sums sha
  case "$(uname -s)" in
    Darwin)
      os=mac
      pkg="sa3-$SA3_VERSION-macos-universal.zip"
      url="$MAC_RELEASES"
      sums=SHA256SUMS-macos
      ;;
    Linux)
      os=linux
      local arch
      case "$(uname -m)" in
        x86_64 | amd64) arch=x86_64 ;;
        aarch64 | arm64) arch=aarch64 ;;
        *) die "no prebuilt sa3.cpp for $(uname -m)" ;;
      esac
      pkg="sa3-$SA3_VERSION-linux-$arch.tar.gz"
      url="$LINUX_RELEASES"
      sums=SHA256SUMS-linux
      ;;
    *) die "unsupported OS $(uname -s). On Windows use install.ps1" ;;
  esac

  if command -v sha256sum >/dev/null; then sha="sha256sum"; else sha="shasum -a 256"; fi
  for t in curl claude; do
    command -v "$t" >/dev/null || die "missing '$t'. Install it and run this again"
  done
  [ "$os" = mac ] && { command -v unzip >/dev/null || die "missing 'unzip'"; }

  # the mod looks for sa3-generate under <sa3_dir>/build/bin and weights under <sa3_dir>/models
  local bin="$SA3_HOME/build/bin"

  if [ -x "$bin/sa3-generate" ] && grep -q "\"$SA3_VERSION\"" "$bin/BUILD-INFO.json" 2>/dev/null; then
    say "sa3.cpp $SA3_VERSION already installed"
  else
    say "downloading sa3.cpp $SA3_VERSION for $os (prebuilt, a few MB)"
    tmp="$(mktemp -d)"
    trap 'rm -rf "${tmp:-}"' EXIT
    curl -fsSL -o "$tmp/$pkg" "$url/$pkg"
    curl -fsSL -o "$tmp/SHA256SUMS" "$url/$sums"
    (cd "$tmp" && grep " $pkg\$" SHA256SUMS | $sha -c - >/dev/null) || die "checksum mismatch on $pkg, not installing it"
    rm -rf "$bin"
    mkdir -p "$bin"
    if [ "$os" = mac ]; then
      unzip -q "$tmp/$pkg" -d "$bin"
    else
      tar xzf "$tmp/$pkg" -C "$bin" --strip-components=1
    fi
    note "verified and unpacked to $bin"
  fi
  [ "$os" = linux ] && note "linux runs on the CPU, expect ~5-10s per clip instead of ~1.5s on a Mac"

  say "fetching $SFX_MODEL weights ($SFX_ENCODING). About 1 GB the first time, skipped after"
  (cd "$bin" && bash ./models.sh --variant "$SFX_MODEL" --encoding "$SFX_ENCODING" \
    --ae-encoding "$SFX_ENCODING" --out "$SA3_HOME/models" </dev/null) | sed 's/^/  /'

  say "smoke test: generating a 1s clip"
  local probe
  probe="$(mktemp -d)/probe.wav"
  "$bin/sa3-generate" --model "$SFX_MODEL" --encoding "$SFX_ENCODING" --models-dir "$SA3_HOME/models" \
    --prompt "a short click" --duration 1 --out "$probe" </dev/null >/dev/null 2>&1 \
    || die "sa3-generate failed. Run it by hand to see why: $bin/sa3-generate --help"
  rm -f "$probe"
  note "ok"

  say "installing the sfx-gen plugin"
  # claude reads stdin in places; keep it off the piped script
  if ! claude plugin marketplace add "$REPO" </dev/null >/dev/null 2>&1; then
    claude plugin marketplace update sfx-gen </dev/null >/dev/null 2>&1 || true
  fi
  if claude plugin list </dev/null 2>/dev/null | grep -q 'sfx-gen@sfx-gen'; then
    claude plugin update sfx-gen@sfx-gen </dev/null >/dev/null
    printf '{"sa3_dir":"%s","model":"%s","encoding":"%s"}' "$SA3_HOME" "$SFX_MODEL" "$SFX_ENCODING" \
      | claude plugin configure sfx-gen@sfx-gen --values-stdin >/dev/null
  else
    claude plugin install sfx-gen@sfx-gen \
      --config "sa3_dir=$SA3_HOME" --config "model=$SFX_MODEL" --config "encoding=$SFX_ENCODING" </dev/null >/dev/null
  fi

  command -v ffmpeg >/dev/null || note "optional: install ffmpeg for the mp3 share button"

  echo
  say "done. Start a new claude session and try:"
  note "/sfx a whoosh across the screen"
  note "/sfx-notify error a blood-curdling scream"
}

main "$@"
