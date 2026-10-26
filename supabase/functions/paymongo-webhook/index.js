import {
    ApiError,
    decodeFields,
    encodeFirestore,
    firestoreDocument,
    firestoreRequest,
    firestoreTransaction,
    jsonResponse,
    paymongoRequest
} from "../_shared/backend.js";
import { releaseReservation } from "../order-api/index.js";

Deno.serve(async request => {
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
    try {
        const event = (await request.json()).data;
        if (event?.type !== "checkout_session.payment.paid") return jsonResponse({ received: true });
        const sessionId = String(event.data?.id || "");
        const orderId = String(event.data?.attributes?.reference_number || "");
        if (!/^cs_[A-Za-z0-9_-]+$/.test(sessionId) || !/^[A-Fa-f0-9]{32}$/.test(orderId)) {
            return jsonResponse({ error: "Invalid payment event." }, 400);
        }

        const path = `orders/${orderId}`;
        const orderDocument = await firestoreRequest(path);
        const order = decodeFields(orderDocument.fields);
        if (order.paymongoSessionId !== sessionId) return jsonResponse({ error: "Payment session does not match the order." }, 409);

        const session = await paymongoRequest(`checkout_sessions/${encodeURIComponent(sessionId)}`);
        const attributes = session?.data?.attributes;
        const payment = (attributes?.payments || []).find(item => item?.attributes?.status === "paid");
        if (session?.data?.id !== sessionId
            || attributes?.reference_number !== orderId
            || !payment
            || payment.attributes.currency !== "PHP"
            || Number(payment.attributes.amount) !== Number(order.totalInCentavos)) {
            return jsonResponse({ error: "The payment could not be verified." }, 400);
        }

        let updated = false;
        await firestoreTransaction([path], documents => {
            const current = documents.get(firestoreDocument(path));
            if (!current) throw new ApiError(404, "The order no longer exists.");
            const currentOrder = decodeFields(current.fields);
            if (currentOrder.paymongoSessionId !== sessionId) throw new ApiError(409, "Payment session does not match the order.");
            if (currentOrder.paymentStatus === "Paid") return [];
            if (!["Awaiting payment", "Creating checkout session"].includes(currentOrder.paymentStatus)) return [];
            updated = true;
            return [{
                update: {
                    name: current.name,
                    fields: {
                        paymentStatus: encodeFirestore("Paid"),
                        status: encodeFirestore("Processing"),
                        paymongoPaymentId: encodeFirestore(payment.id || ""),
                        paidAt: encodeFirestore(new Date()),
                        updatedAt: encodeFirestore(new Date())
                    }
                },
                updateMask: { fieldPaths: ["paymentStatus", "status", "paymongoPaymentId", "paidAt", "updatedAt"] },
                currentDocument: { updateTime: current.updateTime }
            }];
        });
        return jsonResponse({ received: true, updated });
    } catch (error) {
        if (error instanceof ApiError) return jsonResponse({ error: error.message }, error.status);
        console.error("PayMongo webhook processing failed.", error);
        return jsonResponse({ error: "Unable to process payment event." }, 500);
    }
});
