/**
 * AI Manager
 * Orchestrates AI tasks between the UI and the Web Worker.
 */

import { state, save } from "../state.js";
import { showToast } from "../utils.js";

class AiManager {
    constructor() {
        this.worker = new Worker("/js/ai/aiWorker.js");
        this.callbacks = new Map();
        this.setupWorker();
    }

    setupWorker() {
        this.worker.onmessage = (e) => {
            const { type, data, error } = e.data;
            if (error) {
                console.error("AI Worker Error:", error);
                showToast("AI Error: " + error);
                return;
            }

            if (this.callbacks.has(type)) {
                this.callbacks.get(type)(data);
            }
        };
    }

    async summarizeNote(id) {
        const note = state.notes.find((n) => n.id === id);
        if (!note) return;

        return new Promise((resolve) => {
            const callback = (result) => {
                if (result.id === id) {
                    note.aiSummary = result.summary;
                    save();
                    resolve(result.summary);
                }
            };
            this.callbacks.set("SUMMARIZE_RESULT", callback);
            this.worker.postMessage({
                type: "SUMMARIZE",
                data: { text: note.content, id },
            });
        });
    }

    async analyzeAllNotes() {
        return new Promise((resolve) => {
            const callback = (analysis) => {
                state.aiAnalysis = analysis;
                save();
                resolve(analysis);
            };
            this.callbacks.set("ANALYZE_RESULT", callback);
            this.worker.postMessage({
                type: "ANALYZE_ALL",
                data: { notes: state.notes },
            });
        });
    }

    async prioritizeTodos() {
        return new Promise((resolve) => {
            const callback = (prioritized) => {
                state.prioritizedTodos = prioritized;
                save();
                resolve(prioritized);
            };
            this.callbacks.set("PRIORITIZE_RESULT", callback);
            this.worker.postMessage({
                type: "PRIORITIZE_TODOS",
                data: { todos: state.todos },
            });
        });
    }

    async checkSecurityHealth() {
        return new Promise((resolve) => {
            const callback = (health) => {
                state.securityHealth = health;
                save();
                resolve(health);
            };
            this.callbacks.set("SECURITY_RESULT", callback);
            this.worker.postMessage({
                type: "SECURITY_HEALTH",
                data: { passwords: state.passwords },
            });
        });
    }

    async getDailyBriefing() {
        return new Promise((resolve) => {
            const callback = (briefing) => {
                state.dailyBriefing = briefing;
                save();
                resolve(briefing);
            };
            this.callbacks.set("BRIEFING_RESULT", callback);
            this.worker.postMessage({
                type: "DAILY_BRIEFING",
                data: {
                    todos: state.todos,
                    notes: state.notes,
                },
            });
        });
    }

    async findSimilarNotes(id) {
        const targetNote = state.notes.find((n) => n.id === id);
        if (!targetNote) return;

        const otherNotes = state.notes.filter((n) => n.id !== id);
        const texts = [targetNote.content, ...otherNotes.map((n) => n.content)];
        const ids = [targetNote.id, ...otherNotes.map((n) => n.id)];

        return new Promise((resolve) => {
            const callback = (similarities) => {
                resolve(similarities);
            };
            this.callbacks.set("SIMILAR_RESULT", callback);
            this.worker.postMessage({
                type: "FIND_SIMILAR",
                data: { texts, ids },
            });
        });
    }

    async generateEmbedding(id) {
        const note = state.notes.find((n) => n.id === id);
        if (!note) return;

        return new Promise((resolve) => {
            const callback = (result) => {
                if (result.id === id) {
                    note.embedding = result.embedding;
                    save();
                    resolve(result.embedding);
                }
            };
            this.callbacks.set("EMBEDDING_RESULT", callback);
            this.worker.postMessage({
                type: "GET_EMBEDDING",
                data: { text: note.content, id },
            });
        });
    }
}

export const aiManager = new AiManager();
window.aiManager = aiManager;
