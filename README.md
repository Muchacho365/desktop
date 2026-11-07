# Personal Manager (Tauri 2.0 Edition)

A high-performance, ultra-lightweight desktop productivity suite built with **Tauri 2.0**, **Rust**, and modern **ES Modules**. Manage your tasks, secure credentials, reading lists, video collections, calendar schedule, notes, and local AI workflows with zero bloat and military-grade persistence.

---

## ⚡ Architectural Highlights (Migration from Electron)

- **90% Smaller Footprint**: Transitioned from a heavy Chromium/Node.js runtime (~150MB+ bundle, >300MB RAM) to a native Rust binary with OS WebView2 (~15MB installer, low idle memory).
- **Self-Healing Rust Backend (`src-tauri/src/main.rs`)**:
  - **Atomic File Swapping**: Every state mutation is buffered to a temporary `.tmp` file and atomically swapped to disk using OS-level file swaps to eliminate power-loss data corruption.
  - **Automated Fallback & Backup Recovery**: Maintains an automatic `appData.json.bak` shadow backup. If primary data is corrupted or unreadable, the backend self-heals by restoring from the backup buffer.
  - **Panic Suppression**: Top-level panic hooks ensure runtime panics are intercepted without crashing the user session.
  - **Unique Device Identification**: Provides high-entropy machine hardware identifiers (`get_device_id`) for cloud synchronization.
- **Dynamic Environment Loading**: Complete removal of hardcoded secrets; API credentials and Firebase endpoints are dynamically bound via `.env` (`import.meta.env`).
- **Unified IPC Interface**: Fully refactored frontend state engine using `@tauri-apps/api/core` `invoke(...)` bridge.

---

## 🎯 Features

- 📝 **Task Management (Todos)**: Kanban and list views, priority weighting, schedule tracking, and search.
- 🛡️ **Securities & Vault**:
  - Password management with local AES encryption and client-side password generator.
  - API key vault with secret masks and quick copy-to-clipboard.
  - Card & payment method storage.
- 📒 **Markdown Notes**: Rich formatting, syntax-highlighted code blocks, custom color tagging, and instant search.
- 📅 **Unified Schedule & Reminders**: Calendar overview across day, week, and month views.
- 📚 **Book Catalog**: Reading status tracking, rating, and embedded study notes.
- 🎬 **Video Library**: Watchlist organization and link categorization.
- 🤖 **On-Device AI Strategy**: Local TensorFlow.js & NLP pipeline for semantic indexing and task prioritization.
- ☁️ **Cloud Synchronization Ready**: Designed for bidirectional sync with `PM-Android-App` via Firebase Firestore.

---

## 🏗️ Project Structure

```text
my-personal-manager/
├── index.html                   # Main application entry point & import map
├── styles.css                   # Responsive layout & dark/light theme styling
├── package.json                 # Node package configuration & Tauri scripts
├── .env                         # Local environment configuration (git-ignored)
├── .env.example                 # Environment template
├── .gitignore                   # Ignore rules (build artifacts, .env, targets)
│
├── src-tauri/                   # Tauri 2.0 Native Rust Engine
│   ├── Cargo.toml               # Rust dependencies (tauri v2, serde, uuid)
│   ├── tauri.conf.json          # Window geometry, identifier & capabilities
│   ├── build.rs                 # Tauri build hook
│   ├── capabilities/
│   │   └── default.json         # Window permission capabilities (core, store)
│   ├── icons/                   # Application icons (.ico, .png, .icns)
│   └── src/
│       └── main.rs              # Self-healing Rust backend & IPC commands
│
└── js/                          # Frontend Architecture (ES Modules)
    ├── app.js                   # UI shell, navigation tabs & sidebar orchestration
    ├── state.js                 # Unified state store & Tauri IPC persistence
    ├── utils.js                 # Cryptographic helpers, clipboard & formatting
    ├── ai/
    │   ├── aiManager.js         # TensorFlow model loader & queue
    │   └── aiWorker.js          # Background NLP worker thread
    ├── components/              # Modular tab controllers
    │   ├── Todos.js
    │   ├── Securities.js
    │   ├── Notes.js
    │   ├── Calendar.js
    │   ├── Books.js
    │   ├── Videos.js
    │   ├── LayoutManager.js
    │   └── AiTools.js
    ├── sync/
    │   └── firebaseConfig.js    # Dynamic import.meta.env Firebase config loader
    └── utils/
        └── markdown.js          # Markdown parsing & syntax highlight pipeline
```

---

## 📋 Prerequisites

Before running or building the project, ensure you have the following installed on your machine:

1. **Node.js**: `v18.0.0` or higher ([Download Node.js](https://nodejs.org/))
2. **Rust & Cargo**: Stable toolchain ([Install via rustup](https://rustup.rs/))
3. **C++ Build Tools**:
   - On Windows: Visual Studio Build Tools (Select **Desktop development with C++** during installation).
   - On Linux: `build-essential libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev`
   - On macOS: Xcode Command Line Tools (`xcode-select --install`)
4. **WebView2**: Built into Windows 10/11 by default.

---

## 🚀 Getting Started

### 1. Installation

Navigate into the application folder and install frontend dependencies:

```bash
cd my-personal-manager
npm install
```

### 2. Environment Setup

Create your local `.env` configuration from the provided template:

```bash
# Windows PowerShell
Copy-Item .env.example .env

# Bash / macOS / Linux
cp .env.example .env
```

Populate `.env` with your project's parameters:

```env
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

---

## 💻 Development Mode

To launch the native desktop application in development mode with live inspection:

```bash
npm run dev
```

*Or invoke the Tauri CLI directly:*

```bash
npx tauri dev
```

*What happens behind the scenes:*
1. The Rust build script checks configuration and generates Windows resource files.
2. The native window launches loading `index.html`.
3. Open DevTools at any time with `F12` or Right-Click -> **Inspect Element**.

---

## 📦 Building for Production

To create an optimized, standalone release package for your operating system:

```bash
npm run build
```

*Or via Tauri CLI:*

```bash
npx tauri build
```

### Output Artifacts:
- **Windows Executable**: `src-tauri/target/release/my-personal-manager.exe`
- **Installer (NSIS / MSI)**: `src-tauri/target/release/bundle/nsis/` or `bundle/msi/`
- **Bundle Size**: ~10–18 MB (Self-contained, no bundled Chromium required)

---

## 🔌 Tauri IPC Protocol

Frontend modules communicate with the Rust backend via high-speed asynchronous channels:

| Command | Rust Signature | Description |
| :--- | :--- | :--- |
| `save_data` | `save_data(app, data: Value)` | Serializes JSON state, creates `.bak` copy, and performs atomic disk flush. |
| `load_data` | `load_data(app)` | Reads `appData.json` with fallback to `appData.json.bak` on parse failure. |
| `get_device_id` | `get_device_id(app)` | Retrieves or atomically provisions a persistent UUID device token. |

### Data Storage Path:
Your application data is stored safely in your user AppData directory:
- **Windows**: `%LOCALAPPDATA%\com.muchacho.personal-manager\appData.json`
- **Linux**: `~/.local/share/com.muchacho.personal-manager/appData.json`
- **macOS**: `~/Library/Application Support/com.muchacho.personal-manager/appData.json`

---

## 🛠️ Troubleshooting

- **Rust Linker Errors on Windows**: Ensure you have installed Visual Studio C++ Build Tools with the Windows 10/11 SDK.
- **WebView2 Missing**: On older Windows systems, download the [Evergreen WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
- **Permission Errors**: Verify that your terminal has read/write privileges in the working directory.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for details.
