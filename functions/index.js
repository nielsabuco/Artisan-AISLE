const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");

initializeApp();

const db = getFirestore();
const REGION = "asia-southeast1";
const PAYMONGO_SECRET_KEY = defineSecret("PAYMONGO_SECRET_KEY");
const BASE_URL = (process.env.APP_BASE_URL || "https://artisan-79f5d.web.app").replace(/\/+$/, "");
const PAYMENT_METHODS = {
    GCash: "gcash",
    Maya: "paymaya",
    "Credit / Debit Card": "card"
};
const STATIC_PRODUCTS = {
    "Woven Handbag": { price: 650 },
    "Rattan Basket": { price: 550 },
    "Wooden Vase": { price: 450 },
    "Macrame Wall Hanging": { price: 750 },
    "Traditional Salakot Hat": { price: 250 },
    "Handmade Lamp": { price: 750 },
    "Ceramic Vase": { price: 500 },
    "Ceramic Bowl": { price: 500 }
};
const toCentavos = amount => Math.round(Number(amount) * 100);
const isValidPhone = phone => /^(?:\+?63|0)9\d{9}$/.test(String(phone || "").replace(/[\s-]/g, ""));

async function paymongoRequest(path, method = "GET", body) {
    const response = await fetch(`https://api.paymongo.com/v2/${path}`, {
        method,
        headers: {
            Authorization: `Basic ${Buffer.from(`${PAYMONGO_SECRET_KEY.value()}:`).toString("base64")}`,
            "Content-Type": "application/json"
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    let result;
    try {
        result = await response.json();
    } catch (error) {
        logger.error("PayMongo returned a non-JSON response.", { status: response.status });
        throw new Error("The payment provider returned an invalid response.");
    }
    if (!response.ok) {
        logger.error("PayMongo request failed.", { status: response.status, errors: result.errors });
        throw new Error("The payment provider could not process this request.");
    }
    return result;
}

function getPaymongoSessionId(session) {
    return session?.data?.id || session?.id || null;
}

function hasPaidPayment(session) {
    return (session?.data?.attributes?.payments || [])
        .some(payment => payment?.attributes?.status === "paid");
}

async function releaseReservation(orderId, paymentStatus, orderStatus) {
    const orderRef = db.collection("orders").doc(orderId);
    return db.runTransaction(async transaction => {
        const orderSnapshot = await transaction.get(orderRef);
        if (!orderSnapshot.exists) return null;
        const order = orderSnapshot.data();
        if (!["Awaiting payment", "Creating checkout session"].includes(order.paymentStatus)) return order;

        const deductions = order.stockDeductions || {};
        const productSnapshots = new Map();
        for (const productId of Object.keys(deductions)) {
            const productRef = db.collection("products").doc(productId);
            productSnapshots.set(productId, {
                ref: productRef,
                snapshot: await transaction.get(productRef)
            });
        }

        for (const [productId, quantity] of Object.entries(deductions)) {
            const product = productSnapshots.get(productId);
            if (!product.snapshot.exists) continue;
            const currentStock = Number(product.snapshot.data().stock);
            if (!Number.isFinite(currentStock)) continue;
            const stock = currentStock + Number(quantity);
            const update = {
                stock,
                lastStockOrderId: orderId,
                updatedAt: FieldValue.serverTimestamp()
            };
            const previousStatus = order.stockStatusBefore?.[productId];
            if (previousStatus) update.status = previousStatus;
            else if (stock > 0 && product.snapshot.data().status === "Out of Stock") update.status = "In Stock";
            transaction.update(product.ref, update);
        }

        transaction.update(orderRef, {
            paymentStatus,
            status: orderStatus,
            reservationReleasedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });
        return { ...order, paymentStatus, status: orderStatus };
    });
}

async function reserveOrder(request, payment) {
    if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in before checkout.");
    const data = request.data || {};
    const buyerName = String(data.buyerName || "").trim();
    const phone = String(data.phone || "").trim();
    const shippingAddress = String(data.shippingAddress || "").trim();
    const shippingCity = String(data.shippingCity || "").trim();
    if (!buyerName || !isValidPhone(phone) || !shippingAddress || !shippingCity) {
        throw new HttpsError("invalid-argument", "Provide a valid name, Philippine mobile number, and complete shipping address.");
    }
    if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > 30) {
        throw new HttpsError("invalid-argument", "Your cart must contain between 1 and 30 products.");
    }

    const requestedItems = data.items.map(item => {
        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
            throw new HttpsError("invalid-argument", "Cart quantities must be whole numbers between 1 and 99.");
        }
        return {
            productId: typeof item.productId === "string" && item.productId ? item.productId : null,
            name: String(item.name || "").trim(),
            quantity
        };
    });
    const remoteProductRefs = new Map();
    requestedItems.forEach(item => {
        if (item.productId) remoteProductRefs.set(item.productId, db.collection("products").doc(item.productId));
    });

    const orderRef = db.collection("orders").doc();
    const order = await db.runTransaction(async transaction => {
        const remoteProducts = new Map();
        for (const [productId, productRef] of remoteProductRefs) {
            const snapshot = await transaction.get(productRef);
            if (!snapshot.exists || snapshot.data().deleted || snapshot.data().status === "Out of Stock") {
                throw new HttpsError("failed-precondition", "A product in your cart is no longer available.");
            }
            remoteProducts.set(productId, { ref: productRef, data: snapshot.data() });
        }

        const stockDeductions = {};
        const stockStatusBefore = {};
        const sellerIds = new Set();
        const items = requestedItems.map(item => {
            const remoteProduct = item.productId ? remoteProducts.get(item.productId) : null;
            const staticProduct = !item.productId ? STATIC_PRODUCTS[item.name] : null;
            if (!remoteProduct && !staticProduct) {
                throw new HttpsError("failed-precondition", "A product in your cart is no longer available.");
            }
            const product = remoteProduct?.data || {};
            const name = remoteProduct ? String(product.name || product.title || "") : item.name;
            const price = Number(remoteProduct ? product.price : staticProduct.price);
            const amount = toCentavos(price);
            if (!name || !Number.isSafeInteger(amount) || amount < 1) {
                throw new HttpsError("failed-precondition", "A product has an invalid price and cannot be checked out.");
            }
            if (remoteProduct?.data.sellerId) sellerIds.add(remoteProduct.data.sellerId);
            if (remoteProduct && Number.isFinite(Number(product.stock))) {
                stockDeductions[item.productId] = (stockDeductions[item.productId] || 0) + item.quantity;
                stockStatusBefore[item.productId] = product.status || null;
            }
            return {
                name,
                price,
                quantity: item.quantity,
                image: remoteProduct?.data.image || remoteProduct?.data.imageUrl || "",
                productId: item.productId,
                sellerId: remoteProduct?.data.sellerId || null
            };
        });

        for (const [productId, quantity] of Object.entries(stockDeductions)) {
            const product = remoteProducts.get(productId);
            if (Number(product.data.stock) < quantity) {
                throw new HttpsError("failed-precondition", `${product.data.name || "A product"} does not have enough stock.`);
            }
        }

        const subtotalInCentavos = items.reduce((total, item) => total + toCentavos(item.price) * item.quantity, 0);
        const shippingInCentavos = 6000;
        const totalInCentavos = subtotalInCentavos + shippingInCentavos;
        if (!Number.isSafeInteger(totalInCentavos) || totalInCentavos < 1) {
            throw new HttpsError("invalid-argument", "The checkout total is invalid.");
        }
        const orderData = {
            uid: request.auth.uid,
            buyerName,
            buyerEmail: request.auth.token.email || "",
            phone,
            shippingAddress,
            shippingCity,
            paymentMethod: payment.method,
            paymentProvider: payment.provider,
            paymentStatus: payment.paymentStatus,
            status: payment.status,
            subtotal: subtotalInCentavos / 100,
            shipping: shippingInCentavos / 100,
            total: totalInCentavos / 100,
            totalInCentavos,
            items,
            productIds: [...new Set(items.map(item => item.productId).filter(Boolean))],
            sellerIds: [...sellerIds],
            stockDeductions,
            stockStatusBefore,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };
        transaction.set(orderRef, orderData);
        for (const [productId, quantity] of Object.entries(stockDeductions)) {
            const product = remoteProducts.get(productId);
            const remainingStock = Number(product.data.stock) - quantity;
            const update = {
                stock: remainingStock,
                lastStockOrderId: orderRef.id,
                updatedAt: FieldValue.serverTimestamp()
            };
            if (remainingStock <= 0) update.status = "Out of Stock";
            transaction.update(product.ref, update);
        }
        return orderData;
    });
    return { orderRef, order };
}

exports.createCashOnDeliveryOrder = onCall(
    { region: REGION },
    async request => {
        const { orderRef } = await reserveOrder(request, {
            method: "Cash on Delivery",
            provider: "Cash on Delivery",
            paymentStatus: "Due on delivery",
            status: "Processing"
        });
        return { orderId: orderRef.id };
    }
);

exports.createPayMongoCheckout = onCall(
    { region: REGION, secrets: [PAYMONGO_SECRET_KEY] },
    async request => {
        if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in before checkout.");
        const method = PAYMENT_METHODS[request.data?.paymentMethod];
        if (!method) throw new HttpsError("invalid-argument", "Choose GCash, Maya, or card.");

        let reservation;
        let checkoutSessionId;
        try {
            reservation = await reserveOrder(request, {
                method: request.data.paymentMethod,
                provider: "PayMongo",
                paymentStatus: "Creating checkout session",
                status: "Awaiting Payment"
            });
            const { orderRef, order } = reservation;
            const lineItems = order.items.map(item => ({
                name: item.name,
                amount: toCentavos(item.price),
                currency: "PHP",
                quantity: item.quantity
            }));
            lineItems.push({ name: "Shipping", amount: 6000, currency: "PHP", quantity: 1 });
            const session = await paymongoRequest("checkout_sessions", "POST", {
                data: {
                    attributes: {
                        line_items: lineItems,
                        payment_method_types: [method],
                        success_url: `${BASE_URL}/index.html?screen=orders&payment=success`,
                        cancel_url: `${BASE_URL}/index.html?screen=orders&payment=cancelled&orderId=${encodeURIComponent(orderRef.id)}`,
                        reference_number: orderRef.id,
                        pass_on_fees: false,
                        send_email_receipt: true,
                        metadata: { orderId: orderRef.id, userId: request.auth.uid }
                    }
                }
            });
            checkoutSessionId = getPaymongoSessionId(session);
            const checkoutUrl = session?.data?.attributes?.checkout_url;
            if (!checkoutSessionId || !checkoutUrl || new URL(checkoutUrl).hostname !== "checkout.paymongo.com") {
                throw new Error("PayMongo returned an invalid hosted checkout URL.");
            }
            await orderRef.update({
                paymongoSessionId: checkoutSessionId,
                paymentStatus: "Awaiting payment",
                updatedAt: FieldValue.serverTimestamp()
            });
            return { orderId: orderRef.id, checkoutUrl };
        } catch (error) {
            if (reservation) {
                if (checkoutSessionId) {
                    try {
                        await paymongoRequest(`checkout_sessions/${encodeURIComponent(checkoutSessionId)}/expire`, "POST", {});
                    } catch (expireError) {
                        logger.warn("Unable to expire a checkout session after setup failure.", { orderId: reservation.orderRef.id });
                    }
                }
                try {
                    await releaseReservation(reservation.orderRef.id, "Checkout failed", "Payment Setup Failed");
                } catch (releaseError) {
                    logger.error("Unable to release stock after checkout setup failed.", {
                        orderId: reservation.orderRef.id,
                        message: releaseError.message
                    });
                }
            }
            if (error instanceof HttpsError) throw error;
            logger.error("Unable to create PayMongo checkout.", { message: error.message });
            throw new HttpsError("unavailable", "Unable to start online checkout. Your cart has not been charged; please try again.");
        }
    }
);

exports.cancelPayMongoCheckout = onCall(
    { region: REGION, secrets: [PAYMONGO_SECRET_KEY] },
    async request => {
        if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in before cancelling checkout.");
        const orderId = String(request.data?.orderId || "");
        if (!/^[A-Za-z0-9_-]{10,}$/.test(orderId)) throw new HttpsError("invalid-argument", "The order ID is invalid.");
        const orderRef = db.collection("orders").doc(orderId);
        const snapshot = await orderRef.get();
        if (!snapshot.exists || snapshot.data().uid !== request.auth.uid) {
            throw new HttpsError("not-found", "This order could not be found.");
        }
        const order = snapshot.data();
        if (!order.paymongoSessionId || order.paymentStatus !== "Awaiting payment") {
            return { cancelled: false, items: order.items || [] };
        }

        const remoteSession = await paymongoRequest(`checkout_sessions/${encodeURIComponent(order.paymongoSessionId)}`);
        if (hasPaidPayment(remoteSession)) return { cancelled: false, items: order.items || [] };
        let session = remoteSession;
        if (remoteSession?.data?.attributes?.status !== "expired") {
            session = await paymongoRequest(
                `checkout_sessions/${encodeURIComponent(order.paymongoSessionId)}/expire`,
                "POST",
                {}
            );
        }
        if (session?.data?.attributes?.status !== "expired") {
            return { cancelled: false, items: order.items || [] };
        }
        await releaseReservation(orderId, "Cancelled", "Payment Cancelled");
        return { cancelled: true, items: order.items || [] };
    }
);

exports.paymongoWebhook = onRequest(
    { region: REGION, secrets: [PAYMONGO_SECRET_KEY] },
    async (request, response) => {
        if (request.method !== "POST") return response.sendStatus(405);
        const event = request.body?.data;
        if (event?.type !== "checkout_session.payment.paid") return response.sendStatus(200);
        const sessionId = String(event.data?.id || "");
        const orderId = String(event.data?.attributes?.reference_number || "");
        if (!/^cs_[A-Za-z0-9_-]+$/.test(sessionId) || !/^[A-Za-z0-9_-]{10,}$/.test(orderId)) {
            return response.sendStatus(400);
        }

        try {
            const orderRef = db.collection("orders").doc(orderId);
            const orderSnapshot = await orderRef.get();
            if (!orderSnapshot.exists || orderSnapshot.data().paymongoSessionId !== sessionId) {
                return response.sendStatus(404);
            }
            const order = orderSnapshot.data();
            const session = await paymongoRequest(`checkout_sessions/${encodeURIComponent(sessionId)}`);
            const attributes = session?.data?.attributes;
            if (session?.data?.id !== sessionId
                || attributes?.reference_number !== orderId
                || !hasPaidPayment(session)) {
                return response.sendStatus(400);
            }
            const paidPayment = attributes.payments.find(payment => payment?.attributes?.status === "paid");
            const paymentAttributes = paidPayment.attributes;
            if (paymentAttributes.currency !== "PHP"
                || Number(paymentAttributes.amount) !== Number(order.totalInCentavos)) {
                logger.error("PayMongo payment amount does not match its order.", { orderId, sessionId });
                return response.sendStatus(400);
            }

            await db.runTransaction(async transaction => {
                const current = await transaction.get(orderRef);
                if (!current.exists || current.data().paymongoSessionId !== sessionId) {
                    throw new Error("Order session does not match the verified payment.");
                }
                if (current.data().paymentStatus === "Paid") return;
                transaction.update(orderRef, {
                    paymentStatus: "Paid",
                    status: "Processing",
                    paymongoPaymentId: paidPayment.id || null,
                    paidAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            });
            return response.sendStatus(200);
        } catch (error) {
            logger.error("PayMongo webhook processing failed.", { message: error.message });
            return response.sendStatus(500);
        }
    }
);

exports.expirePendingPayMongoOrders = onSchedule(
    {
        region: REGION,
        schedule: "every 60 minutes",
        timeZone: "Asia/Manila",
        secrets: [PAYMONGO_SECRET_KEY]
    },
    async () => {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const pendingOrders = await db.collection("orders")
            .where("paymentStatus", "==", "Awaiting payment")
            .orderBy("createdAt", "asc")
            .limit(100)
            .get();
        for (const orderSnapshot of pendingOrders.docs) {
            const order = orderSnapshot.data();
            if (!order.createdAt || order.createdAt.toMillis() > cutoff || !order.paymongoSessionId) continue;
            try {
                let session = await paymongoRequest(`checkout_sessions/${encodeURIComponent(order.paymongoSessionId)}`);
                if (hasPaidPayment(session)) continue;
                if (session?.data?.attributes?.status !== "expired") {
                    session = await paymongoRequest(
                        `checkout_sessions/${encodeURIComponent(order.paymongoSessionId)}/expire`,
                        "POST",
                        {}
                    );
                }
                if (session?.data?.attributes?.status === "expired") {
                    await releaseReservation(orderSnapshot.id, "Expired", "Payment Expired");
                }
            } catch (error) {
                logger.warn("Unable to expire a pending PayMongo order.", {
                    orderId: orderSnapshot.id,
                    message: error.message
                });
            }
        }
    }
);
