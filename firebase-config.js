window.FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};
const firebaseApp = firebase.initializeApp(window.FIREBASE_CONFIG);
const firestore = firebase.firestore();
const firebaseAuth = firebase.auth();

window.firestore = firestore;
window.firebaseAuth = firebaseAuth;

// Live users
firestore.collection("users").onSnapshot(snapshot => {
    const users = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

    const adminData = getAdminData();
    adminData.users = users;
    saveAdminData(adminData);

    if (typeof renderAdminDashboard === "function") {
        renderAdminDashboard();
    }
});

// Live sellers
firestore.collection("sellers").onSnapshot(snapshot => {
    const sellers = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

    const adminData = getAdminData();
    adminData.sellers = sellers;
    saveAdminData(adminData);

    if (typeof renderAdminDashboard === "function") {
        renderAdminDashboard();
    }
});

// Live products
firestore.collection("products").onSnapshot(snapshot => {
    const products = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

    saveCatalogProducts(products);
    renderHomeProducts();
    renderCatalogProducts();
    updateProductsDisplay();

    if (typeof renderAdminDashboard === "function") {
        renderAdminDashboard();
    }
});

// Live orders
firestore.collection("orders").onSnapshot(snapshot => {
    const orders = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

    const adminData = getAdminData();
    adminData.orders = orders;
    saveAdminData(adminData);
    renderOrders();

    if (typeof renderAdminDashboard === "function") {
        renderAdminDashboard();
    }
});

console.log("Firebase connected successfully.");