import { getApp, getApps, initializeApp } from "firebase/app";
import {
    deleteDoc,
    doc,
    getDoc,
    getFirestore,
    onSnapshot,
    serverTimestamp,
    setDoc,
} from "firebase/firestore";
import { FIREBASE_CONFIG } from "./firebaseConfig.js";

const ROOT_COLLECTION = "pm_user_data";
const SECTIONS_COLLECTION = "sections";
const ITEMS_COLLECTION = "items";
const CHUNKS_COLLECTION = "chunks";
const SCHEMA_VERSION = 3;
const MAX_INLINE_ITEM_BYTES = 700 * 1024;
const ITEM_CHUNK_BYTES = 240 * 1024;
const SYNC_DELAY_MS = 2000;

const CLOUD_SECTIONS = [
    "todos",
    "passwords",
    "apis",
    "cards",
    "videos",
    "books",
    "notes",
    "events",
    "aiAnalysis",
    "prioritizedTodos",
    "securityHealth",
    "dailyBriefing",
];
const ARRAY_SECTIONS = new Set([
    "todos",
    "passwords",
    "apis",
    "cards",
    "videos",
    "books",
    "notes",
    "events",
]);
const DEFAULT_ARRAYS = [
    "todos",
    "passwords",
    "apis",
    "cards",
    "videos",
    "books",
    "notes",
    "events",
];
const EMAIL_KEY = "pm_sync_email";
const DEVICE_KEY = "pm_device_id";
const SECTION_HASHES_KEY = "pm_sync_section_hashes";
const ARRAY_INDEXES_KEY = "pm_sync_array_indexes";

let db = null;
let deviceId = null;
let syncUnsubscribe = null;
let scheduledPushTimer = null;
let scheduledPushSnapshot = null;
let onRemoteChange = null;
let cloudReady = false;

const getDb = () => {
    const configKeys = {
        apiKey: "VITE_FIREBASE_API_KEY",
        authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
        projectId: "VITE_FIREBASE_PROJECT_ID",
        storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
        messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
        appId: "VITE_FIREBASE_APP_ID",
    };
    const missing = Object.entries(configKeys)
        .filter(([key]) => !FIREBASE_CONFIG[key])
        .map(([, envName]) => envName);
    if (missing.length) {
        throw new Error(
            `Firebase is not configured. Set ${missing.join(", ")} in desktop/.env.`,
        );
    }

    if (!db) {
        const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
        db = getFirestore(app);
    }
    return db;
};

const hashString = (text) => {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = (hash << 5) - hash + text.charCodeAt(index);
        hash |= 0;
    }
    return `h${Math.abs(hash).toString(36)}_${text.length}`;
};

const byteLength = (text) => new TextEncoder().encode(text).length;

const sortRecord = (record) =>
    Object.keys(record || {})
        .sort()
        .reduce((sorted, key) => {
            sorted[key] = record[key];
            return sorted;
        }, {});

const normalizeArrayIndex = (index) => ({
    items: sortRecord(index?.items || {}),
    deleted: sortRecord(index?.deleted || {}),
});

const readLocalRecord = (key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
};

const writeLocalRecord = (key, value) =>
    localStorage.setItem(key, JSON.stringify(value));

const readSectionVersions = () => readLocalRecord(SECTION_HASHES_KEY);
const readArrayIndexes = () => {
    const raw = readLocalRecord(ARRAY_INDEXES_KEY);
    return Object.fromEntries(
        Object.entries(raw).map(([section, index]) => [
            section,
            normalizeArrayIndex(index),
        ]),
    );
};

const storeSyncMetadata = (versions, indexes) => {
    writeLocalRecord(SECTION_HASHES_KEY, versions || {});
    writeLocalRecord(
        ARRAY_INDEXES_KEY,
        Object.fromEntries(
            Object.entries(indexes || {}).map(([section, index]) => [
                section,
                normalizeArrayIndex(index),
            ]),
        ),
    );
};

const normalizeSnapshot = (data) => {
    const source = data && typeof data === "object" ? data : {};
    return Object.fromEntries(
        CLOUD_SECTIONS.map((section) => [
            section,
            Object.prototype.hasOwnProperty.call(source, section)
                ? source[section]
                : ARRAY_SECTIONS.has(section)
                  ? []
                  : null,
        ]),
    );
};

const getEmailUid = (email) => {
    let hash = 0;
    for (let index = 0; index < email.length; index += 1) {
        hash = ((hash << 5) - hash) + email.charCodeAt(index);
        hash |= 0;
    }
    return `uid_${Math.abs(hash).toString(36)}_${email.split("@")[0]}`;
};

export const getSyncIdentity = () => {
    const email = localStorage.getItem(EMAIL_KEY);
    return email ? { email, uid: getEmailUid(email) } : null;
};

export const setSyncIdentity = (value) => {
    const email = String(value || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Enter a valid email address to connect to the Android sync account.");
    }
    localStorage.setItem(EMAIL_KEY, email);
    cloudReady = false;
    return { email, uid: getEmailUid(email) };
};

const getRootRef = () => {
    const identity = getSyncIdentity();
    if (!identity) {
        throw new Error("Choose the same email used in the Android app before syncing.");
    }
    return doc(getDb(), ROOT_COLLECTION, identity.uid);
};

const getSectionRef = (section) =>
    doc(getRootRef(), SECTIONS_COLLECTION, section);

const getItemRef = (section, itemId) =>
    doc(getSectionRef(section), ITEMS_COLLECTION, encodeURIComponent(itemId));

const getChunkRef = (section, itemId, index) =>
    doc(
        getItemRef(section, itemId),
        CHUNKS_COLLECTION,
        `chunk_${String(index).padStart(5, "0")}`,
    );

const splitText = (text, maxBytes) => {
    const chunks = [];
    let current = "";
    let size = 0;
    for (const character of text) {
        const characterSize = byteLength(character);
        if (current && size + characterSize > maxBytes) {
            chunks.push(current);
            current = "";
            size = 0;
        }
        current += character;
        size += characterSize;
    }
    if (current || chunks.length === 0) chunks.push(current);
    return chunks;
};

const getItemId = (item) =>
    String(item?.id ?? item?._id ?? hashString(JSON.stringify(item)));

const makeArrayState = (items, previousIndex) => {
    const prior = normalizeArrayIndex(previousIndex);
    const nextItems = {};
    const nextDeleted = { ...prior.deleted };
    const upserts = [];
    const currentIds = new Set();

    (Array.isArray(items) ? items : []).forEach((item) => {
        const itemId = getItemId(item);
        const payloadString = JSON.stringify(item);
        const version = hashString(payloadString);
        const chunkPayloads =
            byteLength(payloadString) > MAX_INLINE_ITEM_BYTES
                ? splitText(payloadString, ITEM_CHUNK_BYTES)
                : null;

        nextItems[itemId] = version;
        currentIds.add(itemId);
        delete nextDeleted[itemId];

        if (prior.items[itemId] !== version || prior.deleted[itemId]) {
            upserts.push({ itemId, item, version, payloadString, chunkPayloads });
        }
    });

    Object.keys(prior.items).forEach((itemId) => {
        if (!currentIds.has(itemId) && !nextDeleted[itemId]) {
            nextDeleted[itemId] =
                `d_${Date.now().toString(36)}_${hashString(itemId)}`;
        }
    });

    const removedIds = Object.keys(nextDeleted).filter(
        (itemId) => prior.deleted[itemId] !== nextDeleted[itemId],
    );
    const nextIndex = normalizeArrayIndex({
        items: nextItems,
        deleted: nextDeleted,
    });
    const version = hashString(
        JSON.stringify({
            items: JSON.stringify(sortRecord(nextIndex.items)),
            deleted: JSON.stringify(sortRecord(nextIndex.deleted)),
        }),
    );

    return { version, nextIndex, upserts, removedIds };
};

const makeItemPayload = (itemState) => ({
    itemId: itemState.itemId,
    version: itemState.version,
    chunkCount: itemState.chunkPayloads?.length || 0,
    isChunked: Boolean(itemState.chunkPayloads),
    ...(itemState.chunkPayloads
        ? {}
        : { payloadString: itemState.payloadString }),
    updatedAtClient: new Date().toISOString(),
    deviceId,
    updatedAtServer: serverTimestamp(),
});

const parsePayload = (value, label) => {
    try {
        return JSON.parse(value);
    } catch (error) {
        throw new Error(`Could not read cloud data for ${label}: ${error.message}`);
    }
};

const readItem = async (section, itemId, existingSnapshot = null) => {
    const snapshot =
        existingSnapshot || (await getDoc(getItemRef(section, itemId)));
    if (!snapshot.exists()) {
        throw new Error(`Cloud sync data is incomplete: missing ${section} item ${itemId}.`);
    }
    const remote = snapshot.data();
    let item;
    if (typeof remote.payloadString === "string") {
        item = parsePayload(remote.payloadString, `${section}/${itemId}`);
    } else if (remote.isChunked || Number(remote.chunkCount) > 0) {
        if (!Number.isInteger(remote.chunkCount) || remote.chunkCount < 1) {
            throw new Error(`Cloud sync data is incomplete: invalid chunks for ${section}/${itemId}.`);
        }
        let payload = "";
        for (let index = 0; index < remote.chunkCount; index += 1) {
            const chunk = await getDoc(getChunkRef(section, itemId, index));
            const segment = chunk.data()?.payloadSegment;
            if (!chunk.exists() || typeof segment !== "string") {
                throw new Error(`Cloud sync data is incomplete: missing chunk ${index} for ${section}/${itemId}.`);
            }
            payload += segment;
        }
        item = parsePayload(payload, `${section}/${itemId}`);
    } else if (Object.prototype.hasOwnProperty.call(remote, "data")) {
        item = remote.data;
    } else {
        throw new Error(`Cloud sync data is incomplete: invalid ${section} item ${itemId}.`);
    }

    if (item?.content == null && Array.isArray(item?.contentChunks)) {
        item.content = item.contentChunks.join("");
        delete item.contentChunks;
    }
    return item;
};

const readLegacyPayload = (remote) => {
    if (remote?.data && typeof remote.data === "object") return remote.data;
    if (typeof remote?.payloadString === "string") {
        return parsePayload(remote.payloadString, "legacy snapshot");
    }
    return null;
};

const readV3Snapshot = async (manifest) => {
    const data = {};
    const nextIndexes = {};
    for (const section of CLOUD_SECTIONS) {
        if (!ARRAY_SECTIONS.has(section)) {
            const sectionSnapshot = await getDoc(getSectionRef(section));
            if (!sectionSnapshot.exists()) {
                data[section] = null;
                continue;
            }
            const payload = sectionSnapshot.data();
            data[section] =
                typeof payload.payloadString === "string"
                    ? parsePayload(payload.payloadString, section)
                    : payload.data ?? null;
            continue;
        }

        const sectionSnapshot = await getDoc(getSectionRef(section));
        if (!sectionSnapshot.exists()) {
            data[section] = [];
            nextIndexes[section] = normalizeArrayIndex({});
            continue;
        }

        const sectionData = sectionSnapshot.data();
        const itemVersions = sectionData.itemVersions || {};
        const deleted = sectionData.deletedItemVersions || {};
        const itemIds = Object.keys(itemVersions);
        const items = [];
        for (const itemId of itemIds) {
            items.push(await readItem(section, itemId));
        }
        data[section] = items;
        nextIndexes[section] = normalizeArrayIndex({
            items: itemVersions,
            deleted,
        });
    }

    storeSyncMetadata(manifest.sectionVersions || {}, nextIndexes);
    return normalizeSnapshot(data);
};

const readV2Snapshot = async (manifest) => {
    const data = {};
    const indexes = {};
    for (const section of CLOUD_SECTIONS) {
        const sectionSnapshot = await getDoc(getSectionRef(section));
        if (!sectionSnapshot.exists()) {
            data[section] = ARRAY_SECTIONS.has(section) ? [] : null;
            continue;
        }
        const payload = sectionSnapshot.data();
        const value =
            typeof payload.payloadString === "string"
                ? parsePayload(payload.payloadString, section)
                : payload.data ?? null;
        data[section] = value;
        if (ARRAY_SECTIONS.has(section)) {
            indexes[section] = {
                items: Object.fromEntries(
                    (Array.isArray(value) ? value : []).map((item) => [
                        getItemId(item),
                        hashString(JSON.stringify(item)),
                    ]),
                ),
                deleted: {},
            };
        }
    }
    storeSyncMetadata(manifest.sectionVersions || {}, indexes);
    return normalizeSnapshot(data);
};

const readV3Changes = async (manifest) => {
    const remoteVersions = manifest.sectionVersions || {};
    const localVersions = readSectionVersions();
    const localIndexes = readArrayIndexes();
    const nextIndexes = { ...localIndexes };
    const patch = {};
    const arrayChanges = {};
    const changedSections = CLOUD_SECTIONS.filter(
        (section) =>
            remoteVersions[section] &&
            localVersions[section] !== remoteVersions[section],
    );

    for (const section of changedSections) {
        if (ARRAY_SECTIONS.has(section)) {
            const localIndex = normalizeArrayIndex(localIndexes[section]);
            const manifestSnapshot = await getDoc(getSectionRef(section));
            if (!manifestSnapshot.exists()) {
                arrayChanges[section] = {
                    upsert: [],
                    remove: Object.keys(localIndex.items),
                };
                nextIndexes[section] = normalizeArrayIndex({});
                continue;
            }

            const sectionData = manifestSnapshot.data();
            const remoteIndex = normalizeArrayIndex({
                items: sectionData.itemVersions,
                deleted: sectionData.deletedItemVersions,
            });
            const upsert = [];
            const remove = Object.keys(remoteIndex.deleted).filter(
                (itemId) =>
                    localIndex.deleted[itemId] !== remoteIndex.deleted[itemId],
            );
            const changedItemIds = Object.keys(remoteIndex.items).filter(
                (itemId) => localIndex.items[itemId] !== remoteIndex.items[itemId],
            );

            for (const itemId of changedItemIds) {
                const itemSnapshot = await getDoc(getItemRef(section, itemId));
                if (!itemSnapshot.exists()) {
                    if (!remove.includes(itemId)) remove.push(itemId);
                    continue;
                }
                upsert.push(await readItem(section, itemId, itemSnapshot));
            }

            if (upsert.length || remove.length) {
                arrayChanges[section] = { upsert, remove };
            }
            nextIndexes[section] = remoteIndex;
            continue;
        }

        const sectionSnapshot = await getDoc(getSectionRef(section));
        if (!sectionSnapshot.exists()) {
            patch[section] = null;
            continue;
        }
        const payload = sectionSnapshot.data();
        patch[section] =
            typeof payload.payloadString === "string"
                ? parsePayload(payload.payloadString, section)
                : payload.data ?? null;
    }

    storeSyncMetadata({ ...localVersions, ...remoteVersions }, nextIndexes);
    if (Object.keys(arrayChanges).length) patch.__delta = arrayChanges;
    return Object.keys(patch).length ? patch : null;
};

export const pullFromCloud = async () => {
    const rootSnapshot = await getDoc(getRootRef());
    if (!rootSnapshot.exists()) return null;
    const remote = rootSnapshot.data();

    if (
        remote.schemaVersion >= SCHEMA_VERSION &&
        remote.sectionVersions &&
        typeof remote.sectionVersions === "object"
    ) {
        return readV3Snapshot(remote);
    }
    if (
        remote.schemaVersion >= 2 &&
        remote.sectionVersions &&
        typeof remote.sectionVersions === "object"
    ) {
        return readV2Snapshot(remote);
    }

    const legacy = readLegacyPayload(remote);
    if (!legacy) return null;
    const normalized = normalizeSnapshot(legacy);
    const versions = {};
    const indexes = {};
    CLOUD_SECTIONS.forEach((section) => {
        if (ARRAY_SECTIONS.has(section)) {
            const state = makeArrayState(normalized[section], {});
            versions[section] = state.version;
            indexes[section] = state.nextIndex;
        } else {
            versions[section] = hashString(JSON.stringify(normalized[section]));
        }
    });
    storeSyncMetadata(versions, indexes);
    return normalized;
};

export const pushToCloud = async (snapshot) => {
    const rootRef = getRootRef();
    deviceId =
        deviceId ||
        localStorage.getItem(DEVICE_KEY) ||
        `desktop_${crypto.randomUUID().replace(/-/g, "")}`;
    localStorage.setItem(DEVICE_KEY, deviceId);

    const normalized = normalizeSnapshot(snapshot);
    const localVersions = readSectionVersions();
    const localIndexes = readArrayIndexes();
    const nextVersions = {};
    const nextIndexes = { ...localIndexes };
    const changedSections = [];

    for (const section of CLOUD_SECTIONS) {
        if (ARRAY_SECTIONS.has(section)) {
            const arrayState = makeArrayState(
                normalized[section],
                localIndexes[section],
            );
            nextVersions[section] = arrayState.version;
            nextIndexes[section] = arrayState.nextIndex;
            if (localVersions[section] === arrayState.version) continue;

            changedSections.push(section);
            for (const itemState of arrayState.upserts) {
                await setDoc(getItemRef(section, itemState.itemId), makeItemPayload(itemState), {
                    merge: true,
                });
                if (itemState.chunkPayloads) {
                    for (let index = 0; index < itemState.chunkPayloads.length; index += 1) {
                        await setDoc(
                            getChunkRef(section, itemState.itemId, index),
                            {
                                index,
                                payloadSegment: itemState.chunkPayloads[index],
                                updatedAtClient: new Date().toISOString(),
                                deviceId,
                                updatedAtServer: serverTimestamp(),
                            },
                            { merge: true },
                        );
                    }
                }
            }

            for (const itemId of arrayState.removedIds) {
                await deleteDoc(getItemRef(section, itemId));
            }
            await setDoc(
                getSectionRef(section),
                {
                    kind: "items",
                    itemVersions: arrayState.nextIndex.items,
                    deletedItemVersions: arrayState.nextIndex.deleted,
                    updatedAtClient: new Date().toISOString(),
                    deviceId,
                    updatedAtServer: serverTimestamp(),
                },
                { merge: true },
            );
            continue;
        }

        const payloadString = JSON.stringify(normalized[section]);
        const version = hashString(payloadString);
        nextVersions[section] = version;
        if (localVersions[section] === version) continue;
        changedSections.push(section);
        await setDoc(
            getSectionRef(section),
            {
                payloadString,
                version,
                updatedAtClient: new Date().toISOString(),
                deviceId,
                updatedAtServer: serverTimestamp(),
            },
            { merge: true },
        );
    }

    if (changedSections.length > 0) {
        await setDoc(
            rootRef,
            {
                schemaVersion: SCHEMA_VERSION,
                sectionVersions: nextVersions,
                updatedAtClient: new Date().toISOString(),
                deviceId,
                updatedAtServer: serverTimestamp(),
            },
            { merge: true },
        );
    }
    storeSyncMetadata(nextVersions, nextIndexes);
    return { changedSections };
};

export const stopLiveSync = () => {
    if (syncUnsubscribe) {
        syncUnsubscribe();
        syncUnsubscribe = null;
    }
    cloudReady = false;
};

export const syncWithCloud = async (snapshot, applyRemoteSnapshot) => {
    onRemoteChange = applyRemoteSnapshot;
    deviceId =
        deviceId ||
        localStorage.getItem(DEVICE_KEY) ||
        `desktop_${crypto.randomUUID().replace(/-/g, "")}`;
    localStorage.setItem(DEVICE_KEY, deviceId);

    const remote = await pullFromCloud();
    let result;
    if (remote) {
        await applyRemoteSnapshot(remote);
        result = { direction: "pulled" };
    } else {
        result = {
            direction: "pushed",
            ...(await pushToCloud(snapshot)),
        };
    }

    cloudReady = true;
    if (syncUnsubscribe) syncUnsubscribe();
    syncUnsubscribe = onSnapshot(
        getRootRef(),
        async (rootSnapshot) => {
            if (!rootSnapshot.exists()) return;
            const manifest = rootSnapshot.data();
            if (manifest.deviceId === deviceId) return;
            try {
                const updated =
                    manifest.schemaVersion >= SCHEMA_VERSION &&
                    manifest.sectionVersions &&
                    typeof manifest.sectionVersions === "object"
                        ? await readV3Changes(manifest)
                        : await pullFromCloud();
                if (updated && onRemoteChange) {
                    await onRemoteChange(updated);
                }
            } catch (error) {
                console.error("[Sync] Could not apply remote changes:", error);
            }
        },
        (error) => {
            console.error("[Sync] Firestore live listener failed:", error);
        },
    );
    return result;
};

export const scheduleSyncPush = (snapshot) => {
    if (!cloudReady || !getSyncIdentity()) return;
    scheduledPushSnapshot = snapshot;
    if (scheduledPushTimer) clearTimeout(scheduledPushTimer);
    scheduledPushTimer = setTimeout(async () => {
        const pending = scheduledPushSnapshot;
        scheduledPushSnapshot = null;
        scheduledPushTimer = null;
        if (!pending) return;
        try {
            const result = await pushToCloud(pending);
            if (result.changedSections.length) {
                console.info(`[Sync] Updated ${result.changedSections.length} cloud section(s).`);
            }
        } catch (error) {
            console.error("[Sync] Could not upload local changes:", error);
        }
    }, SYNC_DELAY_MS);
};
