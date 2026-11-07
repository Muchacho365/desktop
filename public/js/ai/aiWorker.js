/**
 * AI Worker for background processing of notes and app data.
 */

importScripts("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs");
importScripts(
    "https://cdn.jsdelivr.net/npm/@tensorflow-models/universal-sentence-encoder"
);
importScripts("https://unpkg.com/compromise");

let model = null;

async function loadModel() {
    if (!model) {
        model = await use.load();
    }
    return model;
}

// Basic TF-IDF Summarization (Extractive)
function summarize(text, numSentences = 3) {
    if (!text) return "";
    const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [text];
    if (sentences.length <= numSentences) return text;

    const words = text.toLowerCase().match(/\w+/g) || [];
    const freq = {};
    words.forEach((w) => (freq[w] = (freq[w] || 0) + 1));

    const scores = sentences.map((s) => {
        const sWords = s.toLowerCase().match(/\w+/g) || [];
        let score = 0;
        sWords.forEach((w) => (score += freq[w] || 0));
        return score / sWords.length;
    });

    return sentences
        .map((s, i) => ({ s, score: scores[i], i }))
        .sort((a, b) => b.score - a.score)
        .slice(0, numSentences)
        .sort((a, b) => a.i - b.i)
        .map((x) => x.s.trim())
        .join(" ");
}

// Cosine Similarity
function cosineSimilarity(a, b) {
    let dotProduct = 0;
    let mA = 0;
    let mB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        mA += a[i] * a[i];
        mB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
}

// Strategy Analysis
function analyzeStrategy(notes) {
    const indicators = [
        "RSI",
        "MACD",
        "EMA",
        "SMA",
        "VWAP",
        "Bollinger Bands",
        "Fibonacci",
        "Ichimoku",
        "Stochastic",
    ];
    const results = {
        indicators: {},
        tickers: {},
        patterns: {},
        sentiment: { win: 0, loss: 0 },
    };

    notes.forEach((note) => {
        const content = (note.content || "").toUpperCase();
        indicators.forEach((ind) => {
            if (content.includes(ind.toUpperCase())) {
                results.indicators[ind] = (results.indicators[ind] || 0) + 1;
            }
        });

        const tickerMatches = content.match(/\b[A-Z]{3,5}\b/g) || [];
        tickerMatches.forEach((t) => {
            if (!indicators.includes(t)) {
                results.tickers[t] = (results.tickers[t] || 0) + 1;
            }
        });

        if (
            content.includes("WIN") ||
            content.includes("PROFIT") ||
            content.includes("GAINED")
        )
            results.sentiment.win++;
        if (
            content.includes("LOSS") ||
            content.includes("STOP LOSS") ||
            content.includes("LOST")
        )
            results.sentiment.loss++;
    });

    return results;
}

// Todo Prioritization
function prioritizeTodos(todos) {
    return todos
        .map((t) => {
            let score = 0;
            if (t.priority === "high") score += 10;
            if (t.priority === "medium") score += 5;

            if (t.dueDate) {
                const diff = new Date(t.dueDate) - new Date();
                const days = diff / (1000 * 60 * 60 * 24);
                if (days < 0) score += 20; // Overdue
                else if (days < 1) score += 15; // Due today
                else if (days < 3) score += 8;
            }

            const text = (t.text || "").toLowerCase();
            if (
                text.includes("urgent") ||
                text.includes("important") ||
                text.includes("must")
            )
                score += 5;
            if (text.includes("trading") || text.includes("strategy"))
                score += 3;

            return { ...t, aiScore: score };
        })
        .sort((a, b) => b.aiScore - a.aiScore);
}

// Security Health Check
function checkSecurityHealth(passwords) {
    const risks = [];
    let weakCount = 0;
    let duplicateCount = 0;
    const seen = new Set();

    passwords.forEach((p) => {
        if (p.pass && p.pass.length < 20) weakCount++;
        if (seen.has(p.pass)) duplicateCount++;
        seen.add(p.pass);
    });

    if (weakCount > 0)
        risks.push(`${weakCount} passwords seem too short or weak.`);
    if (duplicateCount > 0)
        risks.push(`${duplicateCount} duplicate passwords detected.`);

    return {
        score: Math.max(0, 100 - weakCount * 10 - duplicateCount * 20),
        risks,
    };
}

// Daily Briefing
function generateDailyBriefing(data) {
    const { todos, notes } = data;
    const today = new Date().toISOString().split("T")[0];

    const todayTasks = todos.filter((t) => t.dueDate === today && !t.done);
    const overdue = todos.filter(
        (t) => t.dueDate && t.dueDate < today && !t.done
    );

    let briefing = `Good day! You have ${todayTasks.length} tasks due today and ${overdue.length} overdue items. `;

    if (notes.length > 0) {
        const latestNote = notes[0];
        briefing += `Your latest strategy note is "${
            latestNote.title || "Untitled"
        }". `;
    }

    return briefing;
}

self.onmessage = async (e) => {
    const { type, data } = e.data;

    try {
        switch (type) {
            case "SUMMARIZE":
                const summary = summarize(data.text);
                self.postMessage({
                    type: "SUMMARIZE_RESULT",
                    data: { summary, id: data.id },
                });
                break;

            case "ANALYZE_ALL":
                const analysis = analyzeStrategy(data.notes);
                self.postMessage({ type: "ANALYZE_RESULT", data: analysis });
                break;

            case "PRIORITIZE_TODOS":
                const prioritized = prioritizeTodos(data.todos);
                self.postMessage({
                    type: "PRIORITIZE_RESULT",
                    data: prioritized,
                });
                break;

            case "SECURITY_HEALTH":
                const health = checkSecurityHealth(data.passwords);
                self.postMessage({ type: "SECURITY_RESULT", data: health });
                break;

            case "DAILY_BRIEFING":
                const briefing = generateDailyBriefing(data);
                self.postMessage({ type: "BRIEFING_RESULT", data: briefing });
                break;

            case "FIND_SIMILAR":
                const model = await loadModel();
                const embeddings = await model.embed(data.texts);
                const array = await embeddings.array();
                const target = array[0];
                const others = array.slice(1);
                const similarities = others
                    .map((emb, i) => ({
                        id: data.ids[i + 1],
                        score: cosineSimilarity(target, emb),
                    }))
                    .filter((s) => s.score > 0.75);
                self.postMessage({
                    type: "SIMILAR_RESULT",
                    data: similarities,
                });
                break;

            case "GET_EMBEDDING":
                const m = await loadModel();
                const emb = await m.embed([data.text]);
                const arr = await emb.array();
                self.postMessage({
                    type: "EMBEDDING_RESULT",
                    data: { embedding: arr[0], id: data.id },
                });
                break;
        }
    } catch (error) {
        self.postMessage({ type: "ERROR", error: error.message });
    }
};
