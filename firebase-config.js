window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCwECi3B33jKF-dZ2l9gDquWibjHdvVUO8",
  authDomain: "artisan-79f5d.firebaseapp.com",
  projectId: "artisan-79f5d",
  storageBucket: "artisan-79f5d.firebasestorage.app",
  messagingSenderId: "789206394557",
  appId: "1:789206394557:web:f6eca0481844215afbf9d4",
  measurementId: "G-7JMZPE7Y2F"
};
import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import { createClient } from '@supabase/supabase-js';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
    signOut,
    signInWithPopup,
    GoogleAuthProvider,
    FacebookAuthProvider
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
    updateDoc,
    getDoc,
    deleteDoc,
    query,
    where,
    runTransaction
} from 'firebase/firestore';

const firebaseApp = initializeApp(window.FIREBASE_CONFIG);
const firestore = getFirestore(firebaseApp);
const firebaseAuth = getAuth(firebaseApp);
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
isAnalyticsSupported()
    .then(supported => {
        if (supported) getAnalytics(firebaseApp);
    })
    .catch(error => console.warn('Firebase Analytics unavailable:', error));

window.firestore = firestore;
window.firebaseAuth = firebaseAuth;

const records = name => collection(firestore, name);
const mapSnapshot = snapshot => snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
const authReady = new Promise(resolve => onAuthStateChanged(firebaseAuth, user => {
    window.firebaseUser = user;
    if (typeof updateHeader === 'function') updateHeader();
    resolve(user);
}));

const requireUser = async () => {
    await authReady;
    const user = firebaseAuth.currentUser;
    if (!user) throw new Error('Please log in first.');
    return user;
};

const saveUserProfile = async (profile, role = 'Customer') => {
    const user = await requireUser();
    const data = { ...profile, uid: user.uid, email: user.email, role, updatedAt: serverTimestamp() };
    await setDoc(doc(firestore, 'users', user.uid), data, { merge: true });
    return data;
};

const saveSellerProfile = async profile => {
    const user = await requireUser();
    const data = { ...profile, uid: user.uid, email: user.email, status: profile.status || 'Pending', updatedAt: serverTimestamp() };
    await setDoc(doc(firestore, 'sellers', user.uid), data, { merge: true });
    return data;
};

const saveSocialProfile = async user => {
    const name = user.displayName || user.email?.split('@')[0] || 'ArtisanAisle customer';
    return saveUserProfile({
        name,
        firstName: name.trim().split(/\s+/)[0],
        photoURL: user.photoURL || ''
    }, 'Customer');
};

const uploadProductImage = async file => {
    await requireUser();
    if (!file) return '';
    if (!supabase) throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.');
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
        throw new Error('Please choose an image smaller than 5 MB.');
    }
    const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'jpg';
    const path = `products/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from('product-images').upload(path, file, {
        contentType: file.type,
        upsert: false
    });
    if (error) throw error;
    return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
};

const api = {
    authReady,
    get currentUser() { return firebaseAuth.currentUser; },
    signUp: async ({ name, email, phone, password }) => {
        const result = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        const firstName = name.trim().split(/\s+/)[0];
        await saveUserProfile({ name, firstName, phone }, 'Customer');
        return result.user;
    },
    signIn: (email, password) => signInWithEmailAndPassword(firebaseAuth, email, password),
    signInWithGoogle: async () => {
        const result = await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
        await saveSocialProfile(result.user);
        return result.user;
    },
    signInWithFacebook: async () => {
        const result = await signInWithPopup(firebaseAuth, new FacebookAuthProvider());
        await saveSocialProfile(result.user);
        return result.user;
    },
    signOut: () => signOut(firebaseAuth),
    getUserProfile: async uid => (await getDoc(doc(firestore, 'users', uid))).data(),
    saveUserProfile,
    uploadProductImage,
    createSeller: async ({ name, email, password }) => {
        const result = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        await saveSellerProfile({ name, status: 'Active', category: 'General' });
        return result.user;
    },
    getSeller: async uid => (await getDoc(doc(firestore, 'sellers', uid))).data(),
    getOrder: async orderId => (await getDoc(doc(firestore, 'orders', orderId))).data(),
    getAdminProfile: async uid => (await getDoc(doc(firestore, 'users', uid))).data(),
    adminWrite: async (collectionName, recordId, data) => {
        const user = await requireUser();
        const profile = await api.getAdminProfile(user.uid);
        if (profile?.role !== 'Admin') throw new Error('Admin access is required.');
        await setDoc(doc(firestore, collectionName, recordId), { ...data, updatedAt: serverTimestamp() }, { merge: true });
    },
    adminDelete: async (collectionName, recordId) => {
        const user = await requireUser();
        const profile = await api.getAdminProfile(user.uid);
        if (profile?.role !== 'Admin') throw new Error('Admin access is required.');
        await deleteDoc(doc(firestore, collectionName, recordId));
    },
    subscribeAdminData: async () => {
        const user = firebaseAuth.currentUser;
        if (!user) throw new Error('Please sign in as an admin first.');
        const profile = await api.getAdminProfile(user.uid);
        if (profile?.role !== 'Admin') throw new Error('This account is not an Admin account.');
        if (window.firebaseAdminUnsubscribe) window.firebaseAdminUnsubscribe();

        const adminData = window.firebaseAdminData = {
            users: [],
            sellers: [],
            products: [],
            orders: [],
            reviews: [],
            contactMessages: [],
            loading: true,
            loadedCollections: 0,
            lastSyncedAt: null
        };
        const unsubscribers = ['users', 'sellers', 'products', 'orders', 'reviews', 'contactMessages'].map(name => onSnapshot(
            records(name),
            snapshot => {
                adminData[name] = mapSnapshot(snapshot);
                adminData.loadedCollections += 1;
                adminData.loading = adminData.loadedCollections < 6;
                adminData.lastSyncedAt = new Date();
                if (typeof renderAdminDashboard === 'function') renderAdminDashboard();
            },
            error => console.error(`Admin ${name} listener failed:`, error)
        ));
        window.firebaseAdminUnsubscribe = () => unsubscribers.forEach(unsubscribe => unsubscribe());
        return adminData;
    },
    saveSellerProfile,
    saveCart: async cart => {
        const user = await requireUser();
        await setDoc(doc(firestore, 'users', user.uid, 'private', 'cart'), { items: cart, updatedAt: serverTimestamp() });
    },
    saveContactMessage: async message => {
        const user = firebaseAuth.currentUser;
        await addDoc(records('contactMessages'), { ...message, uid: user?.uid || null, createdAt: serverTimestamp() });
    },
    saveProduct: async product => {
        const user = await requireUser();
        const reference = await addDoc(records('products'), { ...product, sellerId: user.uid, createdAt: serverTimestamp() });
        return { id: reference.id, ...product, sellerId: user.uid };
    },
    subscribeProductReviews: (productId, onChange) => onSnapshot(
        query(records('reviews'), where('productId', '==', productId)),
        snapshot => onChange(mapSnapshot(snapshot)),
        error => console.error('Reviews listener failed:', error)
    ),
    deleteProduct: async productId => {
        const user = await requireUser();
        const reference = doc(firestore, 'products', productId);
        const product = await getDoc(reference);
        if (!product.exists() || product.data().sellerId !== user.uid) throw new Error('You can only delete your own products.');
        await updateDoc(reference, { deleted: true, deletedAt: serverTimestamp() });
    },
    createOrder: async order => {
        const user = await requireUser();
        const reference = doc(records('orders'));
        const orderData = { ...order, uid: user.uid, status: 'Processing', createdAt: serverTimestamp() };
        await runTransaction(firestore, async transaction => {
            const products = [];
            for (const [productId, quantity] of Object.entries(order.stockDeductions || {})) {
                const productReference = doc(firestore, 'products', productId);
                const productSnapshot = await transaction.get(productReference);
                if (!productSnapshot.exists()) throw new Error('A product in your cart is no longer available.');
                const product = productSnapshot.data();
                if (Number.isFinite(Number(product.stock)) && Number(product.stock) < quantity) {
                    throw new Error(`${product.name || 'A product'} does not have enough stock.`);
                }
                products.push({ reference: productReference, product, quantity });
            }
            transaction.set(reference, orderData);
            products.forEach(({ reference: productReference, product, quantity }) => {
                const remainingStock = Number(product.stock) - quantity;
                transaction.update(productReference, {
                    stock: remainingStock,
                    status: remainingStock <= 0 ? 'Out of Stock' : product.status,
                    lastStockOrderId: reference.id,
                    updatedAt: serverTimestamp()
                });
            });
        });
        return { id: reference.id, ...order, uid: user.uid, status: 'Processing' };
    },
    updateOrderStatus: async (orderId, status) => {
        const user = await requireUser();
        const reference = doc(firestore, 'orders', orderId);
        const order = await getDoc(reference);
        if (!order.exists() || !order.data().sellerIds?.includes(user.uid)) throw new Error('You can only update orders containing your products.');
        await updateDoc(reference, { status, updatedAt: serverTimestamp() });
    },
    saveReview: async ({ orderId, productId, rating, comment, reviewerName }) => {
        const user = await requireUser();
        const order = await getDoc(doc(firestore, 'orders', orderId));
        if (!order.exists() || order.data().uid !== user.uid || order.data().status !== 'Delivered') {
            throw new Error('Reviews are available only for your delivered orders.');
        }
        await addDoc(records('reviews'), { orderId, productId, uid: user.uid, reviewerName: reviewerName || user.email, rating, comment, createdAt: serverTimestamp() });
    }
};

window.firebaseApi = api;

onSnapshot(records('products'), snapshot => {
    const remoteProducts = mapSnapshot(snapshot).filter(product => !product.deleted);
    const localProducts = typeof getCatalogProducts === 'function' ? getCatalogProducts() : [];
    const products = [
        ...remoteProducts,
        ...localProducts.filter(localProduct => !remoteProducts.some(remoteProduct =>
            remoteProduct.id === localProduct.id || remoteProduct.name === localProduct.name
        ))
    ];
    window.firebaseProducts = products;
    if (typeof saveCatalogProducts === 'function') saveCatalogProducts(products);
    if (typeof renderHomeProducts === 'function') renderHomeProducts();
    if (typeof renderCatalogProducts === 'function') renderCatalogProducts();
    if (typeof updateProductsDisplay === 'function') updateProductsDisplay();
    if (typeof renderAdminDashboard === 'function') renderAdminDashboard();
}, error => console.error('Products listener failed:', error));

window.firebaseReviews = {};

authReady.then(user => {
    if (!user) return;
    getDoc(doc(firestore, 'users', user.uid)).then(profile => {
        if (profile.data()?.role === 'Admin') api.subscribeAdminData().catch(console.error);
    }).catch(error => console.error('Admin profile lookup failed:', error));
    onSnapshot(query(records('orders'), where('uid', '==', user.uid)), snapshot => {
        window.firebaseOrders = mapSnapshot(snapshot);
        if (typeof renderOrders === 'function') renderOrders();
        if (typeof renderSellerDashboard === 'function') renderSellerDashboard();
    }, error => console.error('Buyer orders listener failed:', error));
    onSnapshot(query(records('orders'), where('sellerIds', 'array-contains', user.uid)), snapshot => {
        const sellerOrders = mapSnapshot(snapshot);
        window.firebaseSellerOrders = sellerOrders;
        if (typeof renderSellerDashboard === 'function') renderSellerDashboard();
    }, error => console.error('Seller orders listener failed:', error));
});

console.log('Firebase connected successfully.');