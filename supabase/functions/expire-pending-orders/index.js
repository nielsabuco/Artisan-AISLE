import {
    ApiError,
    decodeFields,
    firestoreRunQuery,
    firestoreRequest,
    jsonResponse,
    paymongoRequest
} from "../_shared/backend.js";
import { releaseReservation } from "../order-api/index.js";

Deno.serve(async request => {
    const configuredSecret = Deno.env.get("ORDER_CLEANUP_SECRET");
    const suppliedSecret = request.headers.get("x-order-cleanup-secret");
    if (!configuredSecret || !suppliedSecret || suppliedSecret !== configuredSecret) {
        return jsonResponse({ error: "Unauthorized." }, 401);
    }
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

    try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const results = await firestoreRunQuery({
            from: [{ collectionId: "orders" }],
            where: {
                compositeFilter: {
                    op: "AND",
                    filters: [
                        { fieldFilter: { field: { fieldPath: "paymentStatus" }, op: "EQUAL", value: { stringValue: "Awaiting payment" } } },
                        { fieldFilter: { field: { fieldPath: "createdAt" }, op: "LESS_THAN", value: { timestampValue: cutoff } } }
                    ]
                }
            }
        });
        if (!Array.isArray(results)) throw new ApiError(502, "Unable to find expired orders.");
        let expired = 0;
        for (const result of results) {
            const orderDocument = result.document;
            if (!orderDocument) continue;
            const orderId = orderDocument.name.split("/").pop();
            const order = await firestoreRequest(`orders/${orderId}`);
            const data = decodeFields(order.fields);
            if (!data.paymongoSessionId) continue;
            try {
                let session = await paymongoRequest(`checkout_sessions/${encodeURIComponent(data.paymongoSessionId)}`);
                if ((session?.data?.attributes?.payments || []).some(payment => payment?.attributes?.status === "paid")) continue;
                if (session?.data?.attributes?.status !== "expired") {
                    session = await paymongoRequest(`checkout_sessions/${encodeURIComponent(data.paymongoSessionId)}/expire`, "POST", {});
                }
                if (session?.data?.attributes?.status === "expired") {
                    const result = await releaseReservation(orderId, "Expired", "Payment Expired");
                    if (result?.released) expired += 1;
                }
            } catch (error) {
                console.warn("Unable to expire pending PayMongo order.", { orderId, error });
            }
        }
        return jsonResponse({ expired });
    } catch (error) {
        console.error("Pending order cleanup failed.", error);
        return jsonResponse({ error: error.message || "Unable to clean up pending orders." }, error.status || 500);
    }
});
