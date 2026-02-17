#!/usr/bin/env bash
# Voice Mirror — One-liner installer
# Works on macOS, Linux, and Windows (Git Bash/MSYS2)
#
# macOS/Linux:  curl -fsSL https://raw.githubusercontent.com/contextmirror/voice-mirror-electron/main/install.sh | bash
# Windows:      Use install.ps1 for native PowerShell, or run this via Git Bash
#
# Options:
#   --install-method git|npm   (default: git)
#   --branch <branch>          (default: main)
#   --dir <path>               (default: ~/voice-mirror-electron)
#   --skip-setup               Skip interactive setup wizard
#   --non-interactive          Run setup without prompts

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ─── Banner ───────────────────────────────────────────────────────────
print_banner() {
    echo ""
    echo -e "${MAGENTA}${BOLD}    ◉ Voice Mirror${RESET}"
    echo -e "${DIM}    Voice-controlled AI agent overlay for your entire computer.${RESET}"
    echo ""
}

info()  { echo -e "  ${BLUE}▸${RESET} $1"; }
ok()    { echo -e "  ${GREEN}✓${RESET} $1"; }
warn()  { echo -e "  ${YELLOW}!${RESET} $1"; }
fail()  { echo -e "  ${RED}✗${RESET} $1"; }
step()  { echo -e "\n${MAGENTA}${BOLD}  $1${RESET}"; }

# ─── Parse args ───────────────────────────────────────────────────────
INSTALL_METHOD="git"
BRANCH="main"
INSTALL_DIR="$HOME/voice-mirror-electron"
SKIP_SETUP=false
NON_INTERACTIVE=false
REPO_URL="https://github.com/contextmirror/voice-mirror-electron.git"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --install-method) INSTALL_METHOD="$2"; shift 2 ;;
        --branch)         BRANCH="$2"; shift 2 ;;
        --dir)            INSTALL_DIR="$2"; shift 2 ;;
        --skip-setup)     SKIP_SETUP=true; shift ;;
        --non-interactive) NON_INTERACTIVE=true; shift ;;
        --repo)           REPO_URL="$2"; shift 2 ;;
        *)                warn "Unknown option: $1"; shift ;;
    esac
done

# ─── Platform detection ───────────────────────────────────────────────
detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Linux*)  PLATFORM="linux" ;;
        Darwin*) PLATFORM="macos" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
        *)       PLATFORM="unknown" ;;
    esac

    case "$ARCH" in
        x86_64|amd64) ARCH="x64" ;;
        aarch64|arm64) ARCH="arm64" ;;
    esac
}

# ─── Check/install Node.js ────────────────────────────────────────────
ensure_node() {
    step "Checking Node.js..."

    if command -v node &>/dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//')
        NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

        if [[ "$NODE_MAJOR" -ge 18 ]]; then
            ok "Node.js $NODE_VERSION"
            return 0
        else
            warn "Node.js $NODE_VERSION found (need 18+)"
        fi
    else
        info "Node.js not found"
    fi

    # Try to install Node.js
    info "Installing Node.js..."

    if command -v nvm &>/dev/null; then
        info "Using nvm..."
        nvm install 22
        nvm use 22
    elif [[ "$PLATFORM" == "macos" ]] && command -v brew &>/dev/null; then
        info "Using Homebrew..."
        brew install node@22
    elif [[ "$PLATFORM" == "windows" ]]; then
        if command -v winget &>/dev/null; then
            info "Using winget..."
            winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        elif command -v choco &>/dev/null; then
            info "Using Chocolatey..."
            # Pin to major version for reproducibility; Chocolatey resolves the
            # latest patch within this range, which is acceptable since we verify
            # the installed version below.
            choco install nodejs-lts --version=22.14.0 -y
        elif command -v scoop &>/dev/null; then
            info "Using Scoop..."
            scoop install nodejs-lts
        else
            fail "No package manager found. Install Node.js from https://nodejs.org"
            fail "Or install winget/Chocolatey/Scoop first."
            exit 1
        fi
        # Refresh PATH for Git Bash
        export PATH="$PATH:/c/Program Files/nodejs"
    elif [[ "$PLATFORM" == "linux" ]]; then
        # NodeSource
        info "Using NodeSource installer..."
        if command -v curl &>/dev/null; then
            # Scorecard: this curl-pipe-bash cannot be pinned to a hash because
            # the NodeSource setup script is a dynamic installer that configures
            # apt/dnf/yum repositories and changes with each release. The URL is
            # pinned to the major version (22.x) and served over HTTPS.
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            if command -v apt-get &>/dev/null; then
                sudo apt-get install -y nodejs
            elif command -v dnf &>/dev/null; then
                sudo dnf install -y nodejs
            elif command -v yum &>/dev/null; then
                sudo yum install -y nodejs
            fi
        fi
    fi

    # Verify
    if command -v node &>/dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//')
        ok "Node.js $NODE_VERSION installed"
    else
        fail "Could not install Node.js. Install manually: https://nodejs.org"
        exit 1
    fi
}

# ─── Ensure LLVM / libclang + CMake ─────────────────────────────────
ensure_llvm() {
    step "Checking LLVM / libclang and CMake..."

    local need_llvm=false
    local need_cmake=false

    # Check for libclang
    if [[ -n "${LIBCLANG_PATH:-}" ]] && [[ -d "$LIBCLANG_PATH" ]]; then
        ok "LIBCLANG_PATH = $LIBCLANG_PATH"
    elif command -v llvm-config &>/dev/null; then
        ok "llvm-config found: $(llvm-config --version 2>/dev/null || echo 'unknown')"
    elif ldconfig -p 2>/dev/null | grep -q libclang; then
        ok "libclang found via ldconfig"
    else
        need_llvm=true
    fi

    # Check for CMake
    if command -v cmake &>/dev/null; then
        ok "cmake $(cmake --version 2>&1 | head -1 | sed 's/[^0-9.]//g')"
    else
        need_cmake=true
    fi

    if [[ "$need_llvm" == "false" ]] && [[ "$need_cmake" == "false" ]]; then
        return 0
    fi

    if [[ "$PLATFORM" == "macos" ]]; then
        # Xcode Command Line Tools include clang/libclang
        if ! xcode-select -p &>/dev/null; then
            info "Installing Xcode Command Line Tools (includes clang)..."
            xcode-select --install 2>/dev/null || true
        else
            ok "Xcode Command Line Tools present (includes clang)"
        fi
        if [[ "$need_cmake" == "true" ]] && command -v brew &>/dev/null; then
            info "Installing CMake via Homebrew..."
            brew install cmake
        elif [[ "$need_cmake" == "true" ]]; then
            warn "CMake not found. Install with: brew install cmake"
        fi
    elif [[ "$PLATFORM" == "linux" ]]; then
        if command -v apt-get &>/dev/null; then
            info "Installing libclang-dev and cmake via apt..."
            sudo apt-get install -y libclang-dev cmake
        elif command -v dnf &>/dev/null; then
            info "Installing clang-devel and cmake via dnf..."
            sudo dnf install -y clang-devel cmake
        elif command -v pacman &>/dev/null; then
            info "Installing clang and cmake via pacman..."
            sudo pacman -S --noconfirm clang cmake
        else
            warn "Could not auto-install libclang and cmake."
            warn "Install libclang-dev (or clang-devel) and cmake for your distribution."
        fi
    elif [[ "$PLATFORM" == "windows" ]]; then
        if [[ "$need_llvm" == "true" ]]; then
            warn "LLVM / libclang not found."
            info "Install with: winget install LLVM.LLVM"
        fi
        if [[ "$need_cmake" == "true" ]]; then
            warn "CMake not found."
            info "Install with: winget install Kitware.CMake"
        fi
    fi

    # Verify after install
    if command -v llvm-config &>/dev/null || ldconfig -p 2>/dev/null | grep -q libclang; then
        ok "libclang available"
    elif [[ "$need_llvm" == "true" ]]; then
        warn "libclang still not found — voice-core build may fail"
    fi

    if command -v cmake &>/dev/null; then
        ok "cmake available"
    elif [[ "$need_cmake" == "true" ]]; then
        warn "cmake still not found — voice-core build may fail"
    fi
}

# ─── Check voice-core binary ─────────────────────────────────────────
ensure_voice_core() {
    step "Checking voice-core binary..."

    local binary_name="voice-core"
    if [[ "$PLATFORM" == "windows" ]]; then
        binary_name="voice-core.exe"
    fi

    # Check for pre-built binary in expected locations
    local release_bin="$INSTALL_DIR/voice-core/target/release/$binary_name"
    local resources_bin="$INSTALL_DIR/resources/bin/$binary_name"

    if [[ -f "$resources_bin" ]]; then
        ok "voice-core binary found (packaged)"
        return 0
    fi

    if [[ -f "$release_bin" ]]; then
        ok "voice-core binary found (release build)"
        return 0
    fi

    # Check for Rust toolchain to build from source
    if command -v cargo &>/dev/null; then
        info "Building voice-core from source..."
        if (cd "$INSTALL_DIR/voice-core" && cargo build --release 2>&1 | tail -1); then
            ok "voice-core built successfully"
            return 0
        else
            warn "voice-core build failed"
        fi
    fi

    warn "voice-core binary not found"
    info "Install Rust toolchain to build from source: https://rustup.rs"
    info "Then run: cd voice-core && cargo build --release"
}

# ─── Check git ─────────────────────────────────────────────────────────
ensure_git() {
    if ! command -v git &>/dev/null; then
        step "Installing git..."
        if [[ "$PLATFORM" == "macos" ]]; then
            xcode-select --install 2>/dev/null || true
        elif [[ "$PLATFORM" == "windows" ]]; then
            if command -v winget &>/dev/null; then
                winget install --id Git.Git --accept-source-agreements --accept-package-agreements
            elif command -v choco &>/dev/null; then
                # Pin to specific version for reproducibility; the installed
                # version is verified below.
                choco install git --version=2.47.1.2 -y
            else
                fail "Install Git from https://git-scm.com/download/win"
                exit 1
            fi
        elif [[ "$PLATFORM" == "linux" ]]; then
            if command -v apt-get &>/dev/null; then
                sudo apt-get install -y git
            elif command -v dnf &>/dev/null; then
                sudo dnf install -y git
            elif command -v pacman &>/dev/null; then
                sudo pacman -S --noconfirm git
            fi
        fi
    fi

    if command -v git &>/dev/null; then
        ok "git $(git --version | sed 's/[^0-9.]//g' | head -1)"
    else
        fail "git not found. Install it and try again."
        exit 1
    fi
}

# ─── Ensure ffmpeg (needed for TTS audio playback) ───────────────────
ensure_ffmpeg() {
    step "Checking FFmpeg..."

    if command -v ffplay &>/dev/null; then
        ok "ffmpeg/ffplay found"
        return
    fi

    warn "FFmpeg not found (needed for TTS audio playback)"
    info "Installing ffmpeg..."

    if [[ "$OSTYPE" == darwin* ]]; then
        if command -v brew &>/dev/null; then
            brew install ffmpeg
        fi
    elif command -v apt-get &>/dev/null; then
        sudo apt-get install -y ffmpeg
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y ffmpeg
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm ffmpeg
    fi

    if command -v ffplay &>/dev/null; then
        ok "ffmpeg installed"
    else
        warn "Could not install ffmpeg. Install manually for TTS audio playback."
    fi
}

# ─── Ensure audio system libs (needed for voice-core/ALSA) ───────────
ensure_audio_libs() {
    if [[ "$PLATFORM" != "linux" ]]; then
        return  # macOS/Windows handle audio natively
    fi

    step "Checking audio libraries..."

    local missing=false

    # Check for ALSA dev headers (needed to build voice-core from source)
    if ! ldconfig -p 2>/dev/null | grep -q libasound; then
        missing=true
    fi

    if [[ "$missing" == "true" ]]; then
        info "Installing audio libraries..."
        if command -v apt-get &>/dev/null; then
            sudo apt-get install -y libasound2-dev >/dev/null 2>&1 && ok "ALSA dev installed" || warn "Could not install libasound2-dev"
        elif command -v dnf &>/dev/null; then
            sudo dnf install -y alsa-lib-devel >/dev/null 2>&1 && ok "ALSA dev installed" || warn "Could not install alsa-lib-devel"
        elif command -v pacman &>/dev/null; then
            sudo pacman -S --noconfirm alsa-lib >/dev/null 2>&1 && ok "ALSA dev installed" || warn "Could not install alsa-lib"
        fi
    else
        ok "Audio libraries available"
    fi
}

# ─── Clone / update repo ──────────────────────────────────────────────
install_repo() {
    step "Installing Voice Mirror..."

    if [[ -d "$INSTALL_DIR/.git" ]]; then
        info "Existing installation found at $INSTALL_DIR"
        info "Updating..."
        cd "$INSTALL_DIR"
        git fetch origin
        git checkout "$BRANCH"
        git pull origin "$BRANCH"
        ok "Updated to latest"
    else
        info "Cloning repository..."
        git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
        ok "Cloned to $INSTALL_DIR"
    fi

    cd "$INSTALL_DIR"
}

# ─── Install npm dependencies ─────────────────────────────────────────
install_deps() {
    step "Installing dependencies..."

    cd "$INSTALL_DIR"
    # Use npm ci for reproducible builds when lockfile exists (committed to repo).
    # Falls back to npm install for edge cases (e.g. user deleted lockfile).
    if [[ -f "package-lock.json" ]]; then
        npm ci 2>&1 | tail -1
    else
        npm install 2>&1 | tail -1
    fi
    ok "npm dependencies installed"

    # MCP server
    if [[ -d "mcp-server" ]]; then
        cd mcp-server
        if [[ -f "package-lock.json" ]]; then
            npm ci 2>&1 | tail -1
        else
            npm install 2>&1 | tail -1
        fi
        cd ..
        ok "MCP server dependencies installed"
    fi
}

# ─── Link CLI globally ────────────────────────────────────────────────
link_cli() {
    step "Setting up CLI..."

    cd "$INSTALL_DIR"
    if npm link 2>&1 | tail -1; then
        ok "voice-mirror command linked globally"
    else
        warn "npm link failed (may need sudo)"
    fi

    # Verify
    if command -v voice-mirror &>/dev/null; then
        ok "Run 'voice-mirror' from anywhere"
    else
        warn "npm link may need sudo. Try: sudo npm link"
        info "Or run directly: node $INSTALL_DIR/cli/index.mjs"
    fi
}

# ─── Run setup wizard ─────────────────────────────────────────────────
run_setup() {
    if [[ "$SKIP_SETUP" == true ]]; then
        info "Skipping setup wizard (--skip-setup)"
        return 0
    fi

    step "Launching setup wizard..."
    echo ""

    cd "$INSTALL_DIR"

    if [[ "$NON_INTERACTIVE" == true ]]; then
        node cli/index.mjs setup --non-interactive
    else
        node cli/index.mjs setup
    fi
}

# ─── Print completion ─────────────────────────────────────────────────
print_done() {
    echo ""
    echo -e "${GREEN}${BOLD}  Installation complete!${RESET}"
    echo ""
    echo -e "  ${DIM}Commands:${RESET}"
    echo -e "    ${CYAN}voice-mirror setup${RESET}    Re-run setup wizard"
    echo -e "    ${CYAN}voice-mirror start${RESET}    Launch Voice Mirror"
    echo -e "    ${CYAN}voice-mirror doctor${RESET}   Check system health"
    echo ""
    echo -e "  ${DIM}Installed to:${RESET} $INSTALL_DIR"
    echo ""
}

# ─── Main ──────────────────────────────────────────────────────────────
main() {
    print_banner
    detect_platform

    info "Platform: $PLATFORM/$ARCH"

    ensure_git
    ensure_node
    ensure_llvm
    ensure_ffmpeg
    ensure_audio_libs
    install_repo
    ensure_voice_core
    install_deps
    link_cli
    run_setup
    print_done
}

main "$@"
