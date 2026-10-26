import {
    ApiError,
    corsHeaders,
    decodeFields,
    encodeFirestore,
    firestoreDocument,
    firestoreRequest,
    firestoreTransaction,
    jsonResponse,
    verifyFirebaseUser
} from "../_shared/backend.js";

const proofBucket = "payment-proofs";
const maxProofBytes = 5 * 1024 * 1024;
const proofMimeTypes = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
};
const defaultPaymentRecipients = {
    gcashRecipientName: "RENIEL MARBEBE SABUCO",
    gcashNumber: "09914908966",
    mayaRecipientName: "RENIEL MARBEBE SABUCO",
    mayaNumber: "09853551524"
};
const staticProducts = {
    "Woven Handbag": 650,
    "Rattan Basket": 550,
    "Wooden Vase": 450,
    "Macrame Wall Hanging": 750,
    "Traditional Salakot Hat": 250,
    "Handmade Lamp": 750,
    "Ceramic Vase": 500,
    "Ceramic Bowl": 500
};
const phonePattern = /^(?:\+?63|0)9\d{9}$/;
const money = value => Math.round(Number(value) * 100);

function errorResponse(error, headers) {
    if (error instanceof ApiError) return jsonResponse({ error: error.message }, error.status, headers);
    console.error("Order API request failed.", error);
    return jsonResponse({ error: "The order service could not complete your request. Please try again." }, 500, headers);
}

function orderDocument(id, order) {
    return {
        update: {
            name: firestoreDocument(`orders/${id}`),
            fields: Object.fromEntries(Object.entries(order).map(([key, value]) => [key, encodeFirestore(value)]))
        },
        currentDocument: { exists: false }
    };
}

function stockWrite(productDocument, orderId, deduction) {
    const product = decodeFields(productDocument.fields);
    const stock = Number(product.stock) - deduction;
    const fields = {
        stock: encodeFirestore(stock),
        lastStockOrderId: encodeFirestore(orderId),
        updatedAt: encodeFirestore(new Date())
    };
    const paths = ["stock", "lastStockOrderId", "updatedAt"];
    if (stock <= 0) {
        fields.status = encodeFirestore("Out of Stock");
        paths.push("status");
    }
    return {
        update: { name: productDocument.name, fields },
        updateMask: { fieldPaths: paths },
        currentDocument: { updateTime: productDocument.updateTime }
    };
}

function storageConfig() {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new ApiError(503, "Private payment-proof storage is not configured in Supabase.");
    return { url: url.replace(/\/+$/, ""), key };
}

function encodeStoragePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
}

async function uploadPaymentProof(user, orderId, file) {
    if (!(file instanceof File) || !proofMimeTypes[file.type] || file.size < 1 || file.size > maxProofBytes) {
        throw new ApiError(400, "Upload a JPG, PNG, or WebP payment proof photo no larger than 5 MB.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPng = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    const isJpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const isWebp = bytes.length >= 12
        && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
        && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
    if (!(file.type === "image/png" && isPng)
        && !(file.type === "image/jpeg" && isJpeg)
        && !(file.type === "image/webp" && isWebp)) {
        throw new ApiError(400, "The uploaded file is not a valid JPG, PNG, or WebP image.");
    }

    const path = `${orderId}/${user.uid}-${crypto.randomUUID()}.${proofMimeTypes[file.type]}`;
    const { url, key } = storageConfig();
    const response = await fetch(`${url}/storage/v1/object/${proofBucket}/${encodeStoragePath(path)}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key}`,
            apikey: key,
            "Content-Type": file.type,
            "x-upsert": "false"
        },
        body: bytes
    });
    if (!response.ok) {
        const detail = await response.text();
        console.error("Private payment-proof upload failed.", { status: response.status, detail: detail.slice(0, 300) });
        throw new ApiError(502, "Unable to store the payment proof. Please try again.");
    }
    return path;
}

async function deletePaymentProof(path) {
    const { url, key } = storageConfig();
    const response = await fetch(`${url}/storage/v1/object/${proofBucket}`, {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${key}`,
            apikey: key,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ prefixes: [path] })
    });
    if (!response.ok) {
        console.warn("Unable to remove an orphaned payment proof.", { status: response.status, path });
    }
}

async function createPaymentProofUrl(path) {
    const { url, key } = storageConfig();
    const response = await fetch(`${url}/storage/v1/object/sign/${proofBucket}/${encodeStoragePath(path)}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key}`,
            apikey: key,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ expiresIn: 300 })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.signedURL) {
        console.error("Unable to create a payment-proof link.", { status: response.status, message: result.message });
        throw new ApiError(502, "Unable to load the payment proof. Please try again.");
    }
    const signedUrl = result.signedURL.startsWith("http")
        ? result.signedURL
        : `${url}/storage/v1${result.signedURL}`;
    return signedUrl;
}

async function reserveOrder(user, input, payment) {
    const checkout = input.order;
    const buyerName = String(checkout?.buyerName || "").trim();
    const phone = String(checkout?.phone || "").trim();
    const shippingAddress = String(checkout?.shippingAddress || "").trim();
    const shippingCity = String(checkout?.shippingCity || "").trim();
    if (!buyerName || !phonePattern.test(phone.replace(/[\s-]/g, "")) || !shippingAddress || !shippingCity) {
        throw new ApiError(400, "Provide your full name, a valid Philippine mobile number, and complete shipping address.");
    }
    if (!Array.isArray(checkout?.items) || checkout.items.length < 1 || checkout.items.length > 30) {
        throw new ApiError(400, "Your cart must contain between 1 and 30 products.");
    }

    const requested = checkout.items.map(item => {
        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
            throw new ApiError(400, "Cart quantities must be whole numbers between 1 and 99.");
        }
        return {
            productId: typeof item.productId === "string" && item.productId ? item.productId : null,
            name: String(item.name || "").trim(),
            quantity
        };
    });
    const productIds = [...new Set(requested.map(item => item.productId).filter(Boolean))];
    const orderId = crypto.randomUUID().replace(/-/g, "");
    const orderPath = `orders/${orderId}`;
    const allPaths = [...productIds.map(id => `products/${id}`), orderPath];
    let storedOrder;

    await firestoreTransaction(allPaths, documents => {
        const productDocuments = new Map(productIds.map(id => [id, documents.get(firestoreDocument(`products/${id}`))]));
        const totalsByProduct = new Map();
        const sellerIds = new Set();
        const items = requested.map(item => {
            const productDocument = item.productId ? productDocuments.get(item.productId) : null;
            let product;
            if (item.productId) {
                if (!productDocument) throw new ApiError(409, "A product in your cart is no longer available.");
                product = decodeFields(productDocument.fields);
                if (product.deleted || product.status === "Out of Stock") throw new ApiError(409, "A product in your cart is no longer available.");
            } else {
                const price = staticProducts[item.name];
                if (!price) throw new ApiError(409, "A product in your cart is no longer available.");
                product = { name: item.name, price };
            }

            const name = String(product.name || product.title || "").trim();
            const price = Number(product.price);
            if (!name || !Number.isSafeInteger(money(price)) || money(price) < 1) {
                throw new ApiError(409, "A product has an invalid price and cannot be checked out.");
            }
            if (item.productId && Number.isFinite(Number(product.stock))) {
                totalsByProduct.set(item.productId, (totalsByProduct.get(item.productId) || 0) + item.quantity);
            }
            if (product.sellerId) sellerIds.add(product.sellerId);
            return {
                name,
                price,
                quantity: item.quantity,
                image: product.image || product.imageUrl || "",
                productId: item.productId,
                sellerId: product.sellerId || null
            };
        });

        for (const [id, quantity] of totalsByProduct) {
            const product = decodeFields(productDocuments.get(id).fields);
            if (Number(product.stock) < quantity) {
                throw new ApiError(409, `${product.name || "A product"} does not have enough stock.`);
            }
        }

        const subtotalInCentavos = items.reduce((sum, item) => sum + money(item.price) * item.quantity, 0);
        const shippingInCentavos = 6000;
        const totalInCentavos = subtotalInCentavos + shippingInCentavos;
        if (!Number.isSafeInteger(totalInCentavos) || totalInCentavos < 1) throw new ApiError(400, "The checkout total is invalid.");
        storedOrder = {
            uid: user.uid,
            buyerName,
            buyerEmail: user.email,
            phone,
            shippingAddress,
            shippingCity,
            paymentMethod: payment.method,
            paymentProvider: payment.provider,
            paymentStatus: payment.paymentStatus,
            paymentReference: String(checkout.paymentReference || "").trim(),
            status: payment.status,
            subtotal: subtotalInCentavos / 100,
            shipping: shippingInCentavos / 100,
            total: totalInCentavos / 100,
            totalInCentavos,
            items,
            productIds,
            sellerIds: [...sellerIds],
            stockDeductions: Object.fromEntries(totalsByProduct),
            stockStatusBefore: Object.fromEntries([...totalsByProduct.keys()].map(id => [
                id,
                decodeFields(productDocuments.get(id).fields).status || null
            ])),
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const writes = [orderDocument(orderId, storedOrder)];
        for (const [id, quantity] of totalsByProduct) {
            writes.push(stockWrite(productDocuments.get(id), orderId, quantity));
        }
        return writes;
    });

    return { orderId, order: storedOrder };
}

async function requireConfiguredPaymentMethod(method) {
    let settings;
    try {
        settings = decodeFields((await firestoreRequest("settings/paymentMethods")).fields);
    } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
            settings = defaultPaymentRecipients;
        } else {
            throw error;
        }
    }
    const prefix = method === "GCash" ? "gcash" : "maya";
    const name = String(settings[`${prefix}RecipientName`] || defaultPaymentRecipients[`${prefix}RecipientName`]).trim();
    const number = String(settings[`${prefix}Number`] || defaultPaymentRecipients[`${prefix}Number`]).trim();
    if (!name || !number) {
        throw new ApiError(409, `${method} is not configured for payment yet. Choose another payment method or contact the store.`);
    }
}

async function requireAdmin(user) {
    if (user.email?.trim().toLowerCase() !== "reniel.sabuco@ssu.edu.ph" || !user.emailVerified) {
        throw new ApiError(403, "Sign in with the verified administrator email to perform this action.");
    }
}

async function createManualOrder(user, body, proof) {
    const order = body.order;
    const method = order?.paymentMethod;
    if (!["GCash", "Maya"].includes(method)) throw new ApiError(400, "Choose GCash, Maya, or Cash on Delivery.");
    const reference = String(order.paymentReference || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._/#-]{3,79}$/.test(reference)) {
        throw new ApiError(400, "Enter a valid GCash or Maya transaction reference number.");
    }
    if (!(proof instanceof File) || !proofMimeTypes[proof.type] || proof.size < 1 || proof.size > maxProofBytes) {
        throw new ApiError(400, "A JPG, PNG, or WebP payment proof photo no larger than 5 MB is required.");
    }
    await requireConfiguredPaymentMethod(method);
    const { orderId } = await reserveOrder(user, body, {
        method,
        provider: "Manual",
        paymentStatus: "Uploading payment proof",
        status: "Awaiting Payment Proof"
    });

    let proofPath;
    try {
        proofPath = await uploadPaymentProof(user, orderId, proof);
        await firestoreTransaction([`orders/${orderId}`], documents => {
            const snapshot = documents.get(firestoreDocument(`orders/${orderId}`));
            if (!snapshot) throw new ApiError(404, "The order could not be saved.");
            const stored = decodeFields(snapshot.fields);
            if (stored.paymentStatus !== "Uploading payment proof") {
                throw new ApiError(409, "This order is no longer waiting for its payment proof.");
            }
            return [{
                update: {
                    name: snapshot.name,
                    fields: {
                        paymentProofPath: encodeFirestore(proofPath),
                        paymentStatus: encodeFirestore("Awaiting payment verification"),
                        status: encodeFirestore("Awaiting Payment Verification"),
                        updatedAt: encodeFirestore(new Date())
                    }
                },
                updateMask: { fieldPaths: ["paymentProofPath", "paymentStatus", "status", "updatedAt"] },
                currentDocument: { updateTime: snapshot.updateTime }
            }];
        });
        return { orderId };
    } catch (error) {
        if (proofPath) {
            try {
                await deletePaymentProof(proofPath);
            } catch (cleanupError) {
                console.warn("Unable to remove payment proof after order setup failed.", cleanupError);
            }
        }
        try {
            await releaseReservation(orderId, "Payment proof upload failed", "Payment Proof Upload Failed");
        } catch (releaseError) {
            console.error("Unable to release stock after payment proof upload failed.", releaseError);
        }
        throw error;
    }
}

async function confirmManualPayment(user, orderId) {
    if (!/^[A-Fa-f0-9]{32}$/.test(String(orderId || ""))) throw new ApiError(400, "The order ID is invalid.");
    await requireAdmin(user);
    let confirmed = false;
    await firestoreTransaction([`orders/${orderId}`], documents => {
        const snapshot = documents.get(firestoreDocument(`orders/${orderId}`));
        if (!snapshot) throw new ApiError(404, "This order could not be found.");
        const order = decodeFields(snapshot.fields);
        if (order.paymentStatus === "Paid") {
            confirmed = true;
            return [];
        }
        if (!["GCash", "Maya"].includes(order.paymentMethod)
            || order.paymentStatus !== "Awaiting payment verification"
            || order.status !== "Awaiting Payment Verification"
            || !order.paymentReference
            || !order.paymentProofPath) {
            throw new ApiError(409, "This order is missing payment details or proof, and cannot be confirmed.");
        }
        confirmed = true;
        return [{
            update: {
                name: snapshot.name,
                fields: {
                    paymentStatus: encodeFirestore("Paid"),
                    status: encodeFirestore("Processing"),
                    paymentVerifiedBy: encodeFirestore(user.uid),
                    paymentVerifiedAt: encodeFirestore(new Date()),
                    updatedAt: encodeFirestore(new Date())
                }
            },
            updateMask: { fieldPaths: ["paymentStatus", "status", "paymentVerifiedBy", "paymentVerifiedAt", "updatedAt"] },
            currentDocument: { updateTime: snapshot.updateTime }
        }];
    });
    return { confirmed };
}

async function getPaymentProof(user, orderId) {
    if (!/^[A-Fa-f0-9]{32}$/.test(String(orderId || ""))) throw new ApiError(400, "The order ID is invalid.");
    const snapshot = await firestoreRequest(`orders/${orderId}`);
    const order = decodeFields(snapshot.fields);
    if (!order.paymentProofPath) throw new ApiError(404, "This order does not have a payment proof.");
    if (order.uid !== user.uid) await requireAdmin(user);
    return { signedUrl: await createPaymentProofUrl(order.paymentProofPath) };
}

export async function releaseReservation(orderId, paymentStatus, orderStatus) {
    const orderPath = `orders/${orderId}`;
    const initial = await firestoreRequest(orderPath);
    const initialOrder = decodeFields(initial.fields);
    if (initialOrder.paymentStatus !== "Uploading payment proof") {
        return { released: false, order: initialOrder };
    }
    const deductions = initialOrder.stockDeductions || {};
    const productIds = Object.keys(deductions);
    const paths = [orderPath, ...productIds.map(id => `products/${id}`)];
    let result;

    await firestoreTransaction(paths, documents => {
        const orderDocumentSnapshot = documents.get(firestoreDocument(orderPath));
        if (!orderDocumentSnapshot) throw new ApiError(404, "This order could not be found.");
        const order = decodeFields(orderDocumentSnapshot.fields);
        if (order.paymentStatus !== "Uploading payment proof") {
            result = { released: false, order };
            return [];
        }
        const updateOrder = {
            ...order,
            paymentStatus,
            status: orderStatus,
            reservationReleasedAt: new Date(),
            updatedAt: new Date()
        };
        const writes = [{
            update: {
                name: orderDocumentSnapshot.name,
                fields: Object.fromEntries(Object.entries(updateOrder).map(([key, value]) => [key, encodeFirestore(value)]))
            },
            updateMask: { fieldPaths: ["paymentStatus", "status", "reservationReleasedAt", "updatedAt"] },
            currentDocument: { updateTime: orderDocumentSnapshot.updateTime }
        }];
        for (const [id, quantity] of Object.entries(deductions)) {
            const product = documents.get(firestoreDocument(`products/${id}`));
            if (!product) continue;
            const current = decodeFields(product.fields);
            if (!Number.isFinite(Number(current.stock))) continue;
            const stock = Number(current.stock) + Number(quantity);
            const fields = {
                stock: encodeFirestore(stock),
                lastStockOrderId: encodeFirestore(orderId),
                updatedAt: encodeFirestore(new Date())
            };
            const updateMask = ["stock", "lastStockOrderId", "updatedAt"];
            const previousStatus = order.stockStatusBefore?.[id];
            if (previousStatus) {
                fields.status = encodeFirestore(previousStatus);
                updateMask.push("status");
            } else if (stock > 0 && current.status === "Out of Stock") {
                fields.status = encodeFirestore("In Stock");
                updateMask.push("status");
            }
            writes.push({
                update: { name: product.name, fields },
                updateMask: { fieldPaths: updateMask },
                currentDocument: { updateTime: product.updateTime }
            });
        }
        result = { released: true, order: updateOrder };
        return writes;
    });
    return result;
}

if (import.meta.main) Deno.serve(async request => {
    const headers = corsHeaders(request.headers.get("Origin") || "");
    if (request.method === "OPTIONS") return new Response("ok", { headers });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, headers);

    try {
        const user = await verifyFirebaseUser(request);
        let body;
        let proof = null;
        if (request.headers.get("Content-Type")?.includes("multipart/form-data")) {
            const contentLength = Number(request.headers.get("Content-Length") || 0);
            if (contentLength > maxProofBytes + 250_000) {
                throw new ApiError(413, "The payment proof upload is too large.");
            }
            const formData = await request.formData();
            try {
                body = { action: formData.get("action"), order: JSON.parse(String(formData.get("order") || "")) };
            } catch {
                throw new ApiError(400, "The submitted order details are invalid.");
            }
            proof = formData.get("proof");
        } else {
            body = await request.json();
        }
        switch (body.action) {
            case "create-order": {
                const method = body.order?.paymentMethod;
                if (!["Cash on Delivery", "GCash", "Maya"].includes(method)) {
                    throw new ApiError(400, "Choose Cash on Delivery, GCash, or Maya.");
                }
                if (method === "Cash on Delivery") {
                    const result = await reserveOrder(user, body, {
                        method,
                        provider: "Cash on Delivery",
                        paymentStatus: "Due on delivery",
                        status: "Processing"
                    });
                    return jsonResponse({ orderId: result.orderId }, 200, headers);
                }
                return jsonResponse(await createManualOrder(user, body, proof), 200, headers);
            }
            case "confirm-payment":
                return jsonResponse(await confirmManualPayment(user, body.orderId), 200, headers);
            case "payment-proof-url":
                return jsonResponse(await getPaymentProof(user, body.orderId), 200, headers);
            case "create-cod": {
                const result = await reserveOrder(user, body, {
                    method: "Cash on Delivery",
                    provider: "Cash on Delivery",
                    paymentStatus: "Due on delivery",
                    status: "Processing"
                });
                return jsonResponse({ orderId: result.orderId }, 200, headers);
            }
            default:
                throw new ApiError(400, "Unsupported order action.");
        }
    } catch (error) {
        return errorResponse(error, headers);
    }
});
