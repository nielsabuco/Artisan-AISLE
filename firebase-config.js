import './styles.css';
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCwECi3B33jKF-dZ2l9gDquWibjHdvVUO8",
  authDomain: "artisan-79f5d.firebaseapp.com",
  projectId: "artisan-79f5d",
  storageBucket: "artisan-79f5d.firebasestorage.app",
  messagingSenderId: "789206394557",
  appId: "1:789206394557:web:f6eca0481844215afbf9d4",
  measurementId: "G-7JMZPE7Y2F"
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