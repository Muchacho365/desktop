// Utility functions
const ENCRYPTION_KEY = "PersonalManager2024SecureKey";

export const uuid = () => {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
};

export const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });
};

export const formatDateTime = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return (
        date.toLocaleDateString("en-US", {
            day: "numeric",
            month: "short",
        }) +
        ", " +
        date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        })
    );
};

export const isOverdue = (dateStr) => {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date(new Date().setHours(0, 0, 0, 0));
};

export const encrypt = async (text) => {
    if (typeof CryptoJS !== "undefined" && CryptoJS?.AES) {
        return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
    }
    return btoa(text);
};

export const decrypt = async (text) => {
    if (typeof CryptoJS !== "undefined" && CryptoJS?.AES) {
        try {
            const bytes = CryptoJS.AES.decrypt(text, ENCRYPTION_KEY);
            const decrypted = bytes.toString(CryptoJS.enc.Utf8);
            if (decrypted) return decrypted;
        } catch (e) {
            console.error("Decryption error:", e);
        }
    }
    try {
        return atob(text);
    } catch {
        return text;
    }
};

export const copyToClipboard = async (text) => {
    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
    }
    showToast("Copied to clipboard!");
};

export const showToast = (message) => {
    const toast = document.createElement("div");
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #22c55e, #16a34a);
        color: white;
        padding: 12px 24px;
        border-radius: 12px;
        font-weight: 600;
        z-index: 3000;
        animation: fadeInUp 0.3s ease-out;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
};

export const showConfirm = (message, onConfirm) => {
    const modals = document.getElementById("modals");
    modals.innerHTML = `
        <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
            <div class="modal confirm-dialog">
                <h2>⚠️ Confirm</h2>
                <p>${message}</p>
                <div class="confirm-actions">
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-danger" id="confirmBtn">Delete</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById("confirmBtn").onclick = () => {
        closeModal();
        onConfirm();
    };
};

export const closeModal = () => {
    document.getElementById("modals").innerHTML = "";
};

// Expose closeModal globally for inline onclick handlers
window.closeModal = closeModal;
