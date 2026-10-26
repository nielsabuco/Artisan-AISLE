import {
    ApiError,
    corsHeaders,
    decodeFields,
    encodeFirestore,
    firestoreDocument,
    firestoreRequest,
    firestoreTransaction,
    jsonResponse,
    paymongoRequest,
    verifyFirebaseUser
} from "../_shared/backend.js";

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
            throw new ApiError(409, "The store has not configured its payment account yet.");
        }
        throw error;
    }
    const prefix = method === "GCash" ? "gcash" : "maya";
    if (!String(settings[`${prefix}RecipientName`] || "").trim() || !String(settings[`${prefix}Number`] || "").trim()) {
        throw new ApiError(409, `${method} is not configured for payment yet. Choose another payment method or contact the store.`);
    }
}

async function confirmManualPayment(user, orderId) {
    if (!/^[A-Fa-f0-9]{32}$/.test(String(orderId || ""))) throw new ApiError(400, "The order ID is invalid.");
    const profileDocument = await firestoreRequest(`users/${user.uid}`);
    const profile = decodeFields(profileDocument.fields);
    if (profile.uid !== user.uid
        || profile.role !== "Admin"
        || profile.email?.toLowerCase() !== user.email?.toLowerCase()) {
        throw new ApiError(403, "Only the approved administrator can confirm payments.");
    }
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
            || !order.paymentReference) {
            throw new ApiError(409, "This order is not waiting for manual payment verification.");
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

export async function releaseReservation(orderId, paymentStatus, orderStatus) {
    const orderPath = `orders/${orderId}`;
    const initial = await firestoreRequest(orderPath);
    const initialOrder = decodeFields(initial.fields);
    if (!["Awaiting payment", "Creating checkout session"].includes(initialOrder.paymentStatus)) {
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
        if (!["Awaiting payment", "Creating checkout session"].includes(order.paymentStatus)) {
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

async function cancelCheckout(user, orderId) {
    if (!/^[A-Fa-f0-9]{32}$/.test(String(orderId || ""))) throw new ApiError(400, "The order ID is invalid.");
    const orderDocumentSnapshot = await firestoreRequest(`orders/${orderId}`);
    const order = decodeFields(orderDocumentSnapshot.fields);
    if (order.uid !== user.uid) throw new ApiError(404, "This order could not be found.");
    if (!order.paymongoSessionId || order.paymentStatus !== "Awaiting payment") {
        return { cancelled: false, items: order.items || [] };
    }
    const sessionId = encodeURIComponent(order.paymongoSessionId);
    let session = await paymongoRequest(`checkout_sessions/${sessionId}`);
    if ((session?.data?.attributes?.payments || []).some(payment => payment?.attributes?.status === "paid")) {
        return { cancelled: false, items: order.items || [] };
    }
    if (session?.data?.attributes?.status !== "expired") {
        session = await paymongoRequest(`checkout_sessions/${sessionId}/expire`, "POST", {});
    }
    if (session?.data?.attributes?.status !== "expired") {
        return { cancelled: false, items: order.items || [] };
    }
    const result = await releaseReservation(orderId, "Cancelled", "Payment Cancelled");
    return { cancelled: result.released, items: order.items || [] };
}

if (import.meta.main) Deno.serve(async request => {
    const headers = corsHeaders(request.headers.get("Origin") || "");
    if (request.method === "OPTIONS") return new Response("ok", { headers });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, headers);

    try {
        const user = await verifyFirebaseUser(request);
        const body = await request.json();
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
                const reference = String(body.order?.paymentReference || "").trim();
                if (!/^[A-Za-z0-9][A-Za-z0-9 ._/#-]{3,79}$/.test(reference)) {
                    throw new ApiError(400, "Enter a valid GCash or Maya transaction reference number.");
                }
                await requireConfiguredPaymentMethod(method);
                const result = await reserveOrder(user, body, {
                    method,
                    provider: "Manual",
                    paymentStatus: "Awaiting payment verification",
                    status: "Awaiting Payment Verification"
                });
                return jsonResponse({ orderId: result.orderId }, 200, headers);
            }
            case "confirm-payment":
                return jsonResponse(await confirmManualPayment(user, body.orderId), 200, headers);
            case "create-cod": {
                const result = await reserveOrder(user, body, {
                    method: "Cash on Delivery",
                    provider: "Cash on Delivery",
                    paymentStatus: "Due on delivery",
                    status: "Processing"
                });
                return jsonResponse({ orderId: result.orderId }, 200, headers);
            }
            case "cancel-checkout":
                return jsonResponse(await cancelCheckout(user, body.orderId), 200, headers);
            default:
                throw new ApiError(400, "Unsupported order action.");
        }
    } catch (error) {
        return errorResponse(error, headers);
    }
});
