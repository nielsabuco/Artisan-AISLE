const FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects";

let googleAccessToken;
let googleTokenExpiresAt = 0;

export class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

export const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
});

export const corsHeaders = origin => {
    const configured = (Deno.env.get("APP_BASE_URL") || "https://artisan-79f5d.web.app").replace(/\/+$/, "");
    const allowed = new Set([configured, "http://localhost:5173", "http://127.0.0.1:5173"]);
    return {
        "Access-Control-Allow-Origin": allowed.has(origin) ? origin : configured,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin"
    };
};

export function encodeFirestore(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestore) } };
    if (typeof value === "boolean") return { booleanValue: value };
    if (typeof value === "number") {
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === "object") {
        return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeFirestore(entry)])) } };
    }
    return { stringValue: String(value) };
}

export function decodeFirestore(value) {
    if (!value || typeof value !== "object") return value;
    if ("stringValue" in value) return value.stringValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return value.doubleValue;
    if ("booleanValue" in value) return value.booleanValue;
    if ("timestampValue" in value) return value.timestampValue;
    if ("nullValue" in value) return null;
    if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestore);
    if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
    return undefined;
}

export function decodeFields(fields = {}) {
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestore(value)]));
}

export function firestoreDocument(path) {
    const projectId = Deno.env.get("FIREBASE_PROJECT_ID") || "artisan-79f5d";
    return `${FIRESTORE_BASE}/${projectId}/databases/(default)/documents/${path}`;
}

function encodeBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodePem(privateKey) {
    const body = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
    const binary = atob(body);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export async function getGoogleAccessToken() {
    if (googleAccessToken && Date.now() < googleTokenExpiresAt - 60_000) return googleAccessToken;
    let account;
    try {
        const encoded = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_B64");
        const json = encoded
            ? new TextDecoder().decode(Uint8Array.from(atob(encoded), character => character.charCodeAt(0)))
            : Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
        account = JSON.parse(json || "");
    } catch {
        throw new ApiError(503, "The Firebase service account is not configured in Supabase.");
    }
    if (!account.client_email || !account.private_key) {
        throw new ApiError(503, "The Firebase service account secret is incomplete.");
    }
    const expectedProject = Deno.env.get("FIREBASE_PROJECT_ID") || "artisan-79f5d";
    if (account.project_id !== expectedProject) {
        throw new ApiError(503, "The Firebase service account does not match the configured project.");
    }
    const now = Math.floor(Date.now() / 1000);
    const header = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const claims = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/datastore",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600
    })));
    const unsignedToken = `${header}.${claims}`;
    const key = await crypto.subtle.importKey(
        "pkcs8",
        decodePem(account.private_key),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsignedToken));
    const assertion = `${unsignedToken}.${encodeBase64Url(new Uint8Array(signature))}`;
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion
        })
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) {
        console.error("Firebase service account token exchange failed.", result.error);
        throw new ApiError(503, "Unable to connect to the Firebase project.");
    }
    googleAccessToken = result.access_token;
    googleTokenExpiresAt = Date.now() + Number(result.expires_in || 3600) * 1000;
    return googleAccessToken;
}

export async function firestoreRequest(path, method = "GET", body) {
    const token = await getGoogleAccessToken();
    const response = await fetch(firestoreDocument(path), {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        console.error("Firestore REST request failed.", { status: response.status, path, message: payload.error?.message });
        throw new ApiError(response.status === 404 ? 404 : 502, "Unable to read or save the order in Firebase.");
    }
    return payload;
}

async function firestoreRpc(method, body) {
    const token = await getGoogleAccessToken();
    const projectId = Deno.env.get("FIREBASE_PROJECT_ID") || "artisan-79f5d";
    const response = await fetch(`${FIRESTORE_BASE}/${projectId}/databases/(default)/documents:${method}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    const payloadText = await response.text();
    if (!response.ok) {
        console.error("Firestore transaction failed.", { status: response.status, method, detail: payloadText.slice(0, 500) });
        throw new ApiError(502, "Unable to save your order securely.");
    }
    if (method === "batchGet") {
        return payloadText.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    }
    return payloadText ? JSON.parse(payloadText) : {};
}

export const firestoreRunQuery = structuredQuery => firestoreRpc("runQuery", { structuredQuery });

export async function firestoreTransaction(paths, buildWrites) {
    const transaction = (await firestoreRpc("beginTransaction", { options: { readWrite: {} } })).transaction;
    if (!transaction) throw new ApiError(502, "Unable to start a secure order transaction.");
    let committed = false;
    try {
        const docs = paths.length
            ? await firestoreRpc("batchGet", { documents: paths.map(firestoreDocument), transaction })
            : [];
        const byName = new Map(docs.filter(item => item.found).map(item => [item.found.name, item.found]));
        const writes = await buildWrites(byName);
        if (writes.length) await firestoreRpc("commit", { transaction, writes });
        committed = true;
        return byName;
    } finally {
        if (!committed) {
            try {
                await firestoreRpc("rollback", { transaction });
            } catch (error) {
                console.warn("Unable to roll back the Firestore transaction.", error);
            }
        }
    }
}

export async function verifyFirebaseUser(request) {
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    const apiKey = Deno.env.get("FIREBASE_WEB_API_KEY");
    if (!token || !apiKey) {
        throw new ApiError(token ? 503 : 401, token ? "Firebase authentication is not configured." : "Please sign in before checkout.");
    }
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token })
    });
    const result = await response.json().catch(() => ({}));
    const user = result.users?.[0];
    if (!response.ok || !user?.localId) throw new ApiError(401, "Your session has expired. Please sign in again.");
    return { uid: user.localId, email: user.email || "", token };
}

export async function paymongoRequest(path, method = "GET", body) {
    const secret = Deno.env.get("PAYMONGO_SECRET_KEY");
    if (!secret) throw new ApiError(503, "PayMongo is not configured for this Supabase project.");
    const response = await fetch(`https://api.paymongo.com/v2/${path}`, {
        method,
        headers: {
            Authorization: `Basic ${btoa(`${secret}:`)}`,
            "Content-Type": "application/json"
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        console.error("PayMongo API request failed.", { status: response.status, errors: payload.errors });
        throw new ApiError(502, "PayMongo could not process this checkout request.");
    }
    return payload;
}
