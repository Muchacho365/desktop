import { state, loadData, save, initSync, getDataSnapshot } from "./state.js";
import { renderTodos, setupTodoActions } from "./components/Todos.js";
import {
    renderSecurities,
    setupSecurityActions,
} from "./components/Securities.js";
import { renderVideos, setupVideoActions } from "./components/Videos.js";
import { renderBooks, setupBookActions } from "./components/Books.js";
import { renderNotes, setupNoteActions } from "./components/Notes.js";
import { renderAiTools, setupAiActions } from "./components/AiTools.js";
import {
    renderLayoutSelector,
    getLayoutClasses,
    setupLayoutActions,
} from "./components/LayoutManager.js";
import { closeModal, showToast } from "./utils.js";
import { isTauri } from "@tauri-apps/api/core";
import {
    getAllWebviewWindows,
    WebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import {
    getSyncIdentity,
    setSyncIdentity,
    syncWithCloud,
} from "./sync/firebaseSync.js";

const render = async () => {
    const app = document.getElementById("app");

    const tabs = [
        { id: "todos", icon: "📝", label: "Todos", desc: "Manage your tasks" },
        {
            id: "securities",
            icon: "🛡️",
            label: "Securities",
            desc: "Vault & Keys",
        },
        { id: "videos", icon: "🎬", label: "Videos", desc: "Watch list" },
        { id: "books", icon: "📚", label: "Books", desc: "Reading list" },
        { id: "notes", icon: "📒", label: "Notes", desc: "Thoughts & ideas" },
        {
            id: "ai-tools",
            icon: "🤖",
            label: "AI Tools",
            desc: "Strategy Analysis",
        },
    ];

    // Sidebar
    const sidebarHtml = `
      <aside class="sidebar ${state.sidebarCollapsed ? "collapsed" : ""}">
        <button class="sidebar-toggle" onclick="window.toggleSidebar()">
            ‹
        </button>
        <div class="sidebar-header">
          <h1>Personal Manager</h1>
          <p>Welcome back, Muchacho</p>
        </div>
        
        <nav class="nav-links">
          ${tabs
              .map(
                  (t) => `
            <button class="nav-item ${state.tab === t.id ? "active" : ""}" 
                    onclick="window.changeTab('${t.id}')">
              <span class="nav-icon">${t.icon}</span>
              <div class="nav-text">
                <span class="nav-label">${t.label}</span>
                <span class="nav-desc">${t.desc}</span>
              </div>
            </button>
          `
              )
              .join("")}
        </nav>

        <div class="sidebar-footer">
          <button class="nav-item" onclick="window.toggleTheme()">
            <span class="nav-icon">${
                state.theme === "dark" ? "☀️" : "🌙"
            }</span>
            <div class="nav-text">
                <span class="nav-label">${
                    state.theme === "dark" ? "Light Mode" : "Dark Mode"
                }</span>
            </div>
          </button>
          <button class="nav-item" onclick="window.checkForUpdates()">
            <span class="nav-icon">🔄</span>
            <div class="nav-text">
                <span class="nav-label">Check Updates</span>
            </div>
          </button>
          <button class="nav-item" onclick="window.handleSync()">
            <span class="nav-icon">☁️</span>
            <div class="nav-text">
                <span class="nav-label">Sync Data</span>
            </div>
          </button>
          <button class="nav-item" onclick="window.exportBackup()">
            <span class="nav-icon">⬆️</span>
            <div class="nav-text">
                <span class="nav-label">Export Backup</span>
            </div>
          </button>
          <button class="nav-item" onclick="window.importBackup()">
            <span class="nav-icon">⬇️</span>
            <div class="nav-text">
                <span class="nav-label">Import Backup</span>
            </div>
          </button>
          <button class="nav-item" onclick="window.openNewWindow()">
            <span class="nav-icon">❐</span>
            <div class="nav-text">
                <span class="nav-label">New Window</span>
            </div>
          </button>
        </div>
      </aside>
    `;

    // Toolbar (Simplified for main content)
    const toolbarHtml = `
      <div class="toolbar">
        <div class="search-box">
          <input type="text" class="search-input" placeholder="Search ${
              state.tab
          }..." value="${state.search}"
                 oninput="window.debounceSearch(this.value)"
                 ${state.search ? "autofocus" : ""}>
          ${
              state.search
                  ? `<button class="clear-search" onclick="state.search=''; render()">✕</button>`
                  : ""
          }
        </div>
        <div class="save-indicator ${state.saveStatus}">
          ${state.saveStatus === "saving" ? "💾 Saving..." : "✓ Saved"}
        </div>
        ${renderLayoutSelector(render)}
      </div>
    `;

    // Content
    let contentHtml = "";
    switch (state.tab) {
        case "todos":
            contentHtml = renderTodos(render);
            break;
        case "securities":
            contentHtml = await renderSecurities(render);
            break;
        case "videos":
            contentHtml = renderVideos(render);
            break;
        case "books":
            contentHtml = renderBooks(render);
            break;
        case "notes":
            contentHtml = renderNotes(render);
            break;
        case "ai-tools":
            contentHtml = renderAiTools(render);
            break;
    }

    app.innerHTML = `
      ${sidebarHtml}
      <main class="main-content">
        ${toolbarHtml}
        <div class="content ${getLayoutClasses()}">${contentHtml}</div>
      </main>
    `;

    // Restore focus if needed
    const searchInput = document.querySelector(".search-input");
    if (searchInput && state.search) {
        searchInput.focus();
        const len = state.search.length;
        searchInput.setSelectionRange(len, len);
    }
};

// Expose render globally
window.render = render;

// Global Actions
window.changeTab = (tab) => {
    state.tab = tab;
    state.search = "";
    state.selectedBook = null;
    render();
};

window.toggleSidebar = () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem("sidebarCollapsed", state.sidebarCollapsed);
    render();
};

window.toggleTheme = () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.body.setAttribute("data-theme", state.theme);
    localStorage.setItem("theme", state.theme);
    render();
};

window.checkForUpdates = () => {
    showToast("Checking for updates...");
    if (window.electronAPI) {
        window.electronAPI.checkForUpdates();
    }
};

const applyCloudSnapshot = async (data) => {
    const arraySections = [
        "todos",
        "passwords",
        "apis",
        "cards",
        "videos",
        "books",
        "notes",
        "events",
    ];
    arraySections.forEach((section) => {
        const delta = data.__delta?.[section];
        if (delta) {
            const removedIds = new Set(
                (delta.remove || []).map((id) => String(id)),
            );
            const items = state[section].filter(
                (item) => !removedIds.has(String(item?.id ?? "")),
            );
            const indexes = new Map(
                items.map((item, index) => [String(item?.id ?? ""), index]),
            );
            (delta.upsert || []).forEach((item) => {
                const itemId = String(item?.id ?? "");
                if (!itemId) return;
                if (indexes.has(itemId)) {
                    items[indexes.get(itemId)] = item;
                } else {
                    items.unshift(item);
                    indexes.set(itemId, 0);
                }
            });
            state[section] = items;
        }
        if (Object.prototype.hasOwnProperty.call(data, section)) {
            state[section] = Array.isArray(data[section]) ? data[section] : [];
        }
    });
    [
        "aiAnalysis",
        "prioritizedTodos",
        "securityHealth",
        "dailyBriefing",
    ].forEach((section) => {
        if (Object.prototype.hasOwnProperty.call(data, section)) {
            state[section] = data[section] || null;
        }
    });
    await save(render, { sync: false });
};

const requestSyncEmail = () =>
    new Promise((resolve) => {
        const modals = document.getElementById("modals");
        modals.innerHTML = `
            <div class="modal-overlay">
                <form class="modal" id="syncEmailForm">
                    <h2>Connect to cloud sync</h2>
                    <p>Enter the same email address you use in the Android app.</p>
                    <div class="form-group">
                        <label for="syncEmail">Email</label>
                        <input id="syncEmail" name="email" type="email" required
                            autocomplete="email" placeholder="you@example.com">
                    </div>
                    <div style="display:flex; gap:12px; justify-content:flex-end;">
                        <button class="btn btn-secondary" type="button" id="cancelSyncEmail">Cancel</button>
                        <button class="btn btn-primary" type="submit">Connect</button>
                    </div>
                </form>
            </div>
        `;

        const form = document.getElementById("syncEmailForm");
        const finish = (email) => {
            closeModal();
            resolve(email);
        };
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            finish(new FormData(form).get("email"));
        });
        document
            .getElementById("cancelSyncEmail")
            .addEventListener("click", () => finish(null));
        modals
            .querySelector(".modal-overlay")
            .addEventListener("click", (event) => {
                if (event.target === event.currentTarget) finish(null);
            });
        document.getElementById("syncEmail").focus();
    });

window.handleSync = async () => {
    let identity = getSyncIdentity();
    if (!identity) {
        const email = await requestSyncEmail();
        if (email === null) return;
        try {
            identity = setSyncIdentity(email);
        } catch (error) {
            console.error("[Sync] Could not set sync identity:", error);
            showToast(error.message);
            return;
        }
    }

    state.syncStatus = "syncing";
    render();
    try {
        const result = await syncWithCloud(getDataSnapshot(), applyCloudSnapshot);
        state.syncStatus = "idle";
        showToast(
            result.direction === "pulled"
                ? `Pulled cloud data for ${identity.email}.`
                : "Uploaded local data to the cloud.",
        );
        render();
    } catch (error) {
        state.syncStatus = "error";
        console.error("[Sync] Could not sync with Firebase:", error);
        showToast(`Sync failed: ${error.message}`);
        render();
    }
};

window.exportBackup = async () => {
    try {
        await save(render);
        const date = new Date().toISOString().slice(0, 10);
        const blob = new Blob([JSON.stringify(getDataSnapshot(), null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `personal-manager-backup-${date}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast("Backup exported.");
    } catch (error) {
        console.error("[Backup] Export failed:", error);
        showToast(`Export failed: ${error.message}`);
    }
};

window.importBackup = async () => {
    const confirmed = window.confirm(
        "Importing a backup will replace your current data. Continue?",
    );
    if (!confirmed) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.hidden = true;
    input.addEventListener(
        "change",
        async () => {
            const [file] = input.files || [];
            input.remove();
            if (!file) return;

            try {
                const imported = JSON.parse(await file.text());
                if (!imported || typeof imported !== "object" || Array.isArray(imported)) {
                    throw new Error("The selected file is not a valid backup object.");
                }
                const supportedSections = [
                    "todos",
                    "passwords",
                    "apis",
                    "cards",
                    "videos",
                    "books",
                    "notes",
                    "events",
                    "layout",
                    "theme",
                    "tab",
                    "aiAnalysis",
                    "prioritizedTodos",
                    "securityHealth",
                    "dailyBriefing",
                ];
                if (!supportedSections.some((key) => key in imported)) {
                    throw new Error("The selected file does not contain Personal Manager data.");
                }
                for (const key of [
                    "todos",
                    "passwords",
                    "apis",
                    "cards",
                    "videos",
                    "books",
                    "notes",
                    "events",
                ]) {
                    if (key in imported && !Array.isArray(imported[key])) {
                        throw new Error(`Backup field "${key}" must be an array.`);
                    }
                }
                if (
                    "layout" in imported &&
                    (!imported.layout ||
                        typeof imported.layout !== "object" ||
                        Array.isArray(imported.layout))
                ) {
                    throw new Error('Backup field "layout" must be an object.');
                }
                if (
                    "theme" in imported &&
                    !["dark", "light"].includes(imported.theme)
                ) {
                    throw new Error('Backup field "theme" must be "dark" or "light".');
                }

                [
                    "todos",
                    "passwords",
                    "apis",
                    "cards",
                    "videos",
                    "books",
                    "notes",
                    "events",
                    "layout",
                    "theme",
                    "tab",
                    "aiAnalysis",
                    "prioritizedTodos",
                    "securityHealth",
                    "dailyBriefing",
                ].forEach((key) => {
                    if (key in imported) state[key] = imported[key];
                });
                document.body.setAttribute("data-theme", state.theme);
                await save(render);
                showToast("Backup imported.");
            } catch (error) {
                console.error("[Backup] Import failed:", error);
                showToast(`Import failed: ${error.message}`);
            }
        },
        { once: true },
    );
    document.body.appendChild(input);
    input.click();
};

window.openNewWindow = async () => {
    if (!isTauri()) {
        window.open(window.location.href, "_blank", "noopener");
        return;
    }

    try {
        const windows = await getAllWebviewWindows();
        const labels = new Set(windows.map(({ label }) => label));
        let index = 1;
        while (labels.has(`app-window-${index}`)) index += 1;

        const newWindow = new WebviewWindow(`app-window-${index}`, {
            url: window.location.href,
            title: "Muchacho Personal Manager",
            width: 1200,
            height: 800,
            resizable: true,
        });
        newWindow.once("tauri://error", (event) => {
            console.error("[Window] Could not open a new window:", event.payload);
            showToast("Could not open a new window.");
        });
    } catch (error) {
        console.error("[Window] Could not open a new window:", error);
        showToast(`Could not open a new window: ${error.message}`);
    }
};

let searchTimeout = null;
window.debounceSearch = (value) => {
    clearTimeout(searchTimeout);
    state.search = value;
    searchTimeout = setTimeout(() => {
        render();
    }, 300);
};

// Setup Keyboard Shortcuts
document.onkeydown = (e) => {
    if (e.ctrlKey || e.metaKey) {
        const tabs = ["todos", "securities", "videos", "books", "notes"];
        if (e.key >= "1" && e.key <= "5") {
            e.preventDefault();
            window.changeTab(tabs[parseInt(e.key) - 1]);
        }
    }
};

// Initialize
const init = async () => {
    // Setup component actions
    setupTodoActions(render);
    setupSecurityActions(render);
    setupVideoActions(render);
    setupBookActions(render);
    setupNoteActions(render);
    setupAiActions(render);
    setupLayoutActions(render);

    // Load data
    await loadData(render);

    // Initialize Sync
    await initSync(render);

    if (getSyncIdentity()) {
        try {
            state.syncStatus = "syncing";
            await syncWithCloud(getDataSnapshot(), applyCloudSnapshot);
            state.syncStatus = "idle";
        } catch (error) {
            state.syncStatus = "error";
            console.error("[Sync] Startup cloud sync failed:", error);
            showToast(`Cloud sync failed: ${error.message}`);
        }
        render();
    }

    // Listen for tray events
    if (window.electronAPI) {
        window.electronAPI.onChangeTab((tab) => {
            window.changeTab(tab);
        });

        // Update listeners
        window.electronAPI.onUpdateAvailable(() => {
            showToast("Update available! Downloading...");
        });

        window.electronAPI.onUpdateNotAvailable(() => {
            showToast("You are on the latest version.");
        });

        window.electronAPI.onUpdateError((err) => {
            console.error(err);
            showToast("Error checking for updates.");
        });
    }
};

init();
