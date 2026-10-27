import './styles.css';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyCwECi3B33jKF-dZ2l9gDquWibjHdvVUO8",
  authDomain: "artisan-79f5d.firebaseapp.com",
  projectId: "artisan-79f5d",
  storageBucket: "artisan-79f5d.firebasestorage.app",
  messagingSenderId: "789206394557",
  appId: "1:789206394557:web:f6eca0481844215afbf9d4",
  measurementId: "G-7JMZPE7Y2F"
};

window.FIREBASE_CONFIG = firebaseConfig;

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

window.firebaseApp = app;
window.firebaseAuth = auth;
window.firestore = db;

/* ==========================================================================
   ArtisanDB Service Layer (Unified Auth, Firestore, GCash, and Orders)
   ========================================================================== */

export const ArtisanDB = {
  app,
  auth,
  db,

  // --- Auth & Users ---
  async registerUser(name, email, phone, password) {
    const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    const user = cred.user;
    if (name) {
      await updateProfile(user, { displayName: name }).catch(() => {});
    }

    const userData = {
      uid: user.uid,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      role: 'user', // Default account role MUST be user
      sellerStatus: 'none', // none | pending | approved | rejected
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    try {
      await setDoc(doc(db, 'users', user.uid), userData);
    } catch (err) {
      console.warn('Firestore set user warning:', err.message);
    }

    // Sync to local session
    this._saveLocalSession(userData);
    return userData;
  },

  async loginUser(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    const user = cred.user;
    const profile = await this.getUserProfile(user.uid);
    const sessionData = profile || {
      uid: user.uid,
      name: user.displayName || email.split('@')[0],
      email: user.email,
      phone: '',
      role: 'user',
      sellerStatus: 'none'
    };
    this._saveLocalSession(sessionData);
    return sessionData;
  },

  async logoutUser() {
    try {
      await signOut(auth);
    } catch (err) {
      console.warn('Sign out error:', err);
    }
    localStorage.removeItem('handicraft_logged_in_user');
    localStorage.removeItem('artisan_seller_logged_in');
    localStorage.removeItem('artisan_current_seller_id');
    localStorage.removeItem('artisan_current_seller_name');
  },

  async getUserProfile(uid) {
    if (!uid) return null;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        return { id: snap.id, ...snap.data() };
      }
    } catch (err) {
      console.warn('Error fetching user profile from Firestore:', err.message);
    }
    return this.getLocalUser();
  },

  async updateUserProfile(uid, data) {
    if (!uid) return;
    try {
      await setDoc(doc(db, 'users', uid), {
        ...data,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.warn('Update user profile warning:', err.message);
    }

    const current = this.getLocalUser() || {};
    const updated = { ...current, ...data };
    this._saveLocalSession(updated);
    return updated;
  },

  onAuth(callback) {
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        const profile = await this.getUserProfile(user.uid);
        const activeUser = profile || {
          uid: user.uid,
          name: user.displayName || user.email.split('@')[0],
          email: user.email,
          role: 'user',
          sellerStatus: 'none'
        };
        this._saveLocalSession(activeUser);
        callback(activeUser);
      } else {
        callback(null);
      }
    });
  },

  getLocalUser() {
    try {
      return JSON.parse(localStorage.getItem('handicraft_logged_in_user') || 'null');
    } catch (e) {
      return null;
    }
  },

  _saveLocalSession(userData) {
    if (!userData) return;
    localStorage.setItem('handicraft_logged_in_user', JSON.stringify(userData));
    localStorage.setItem('handicraft_profile', JSON.stringify({
      name: userData.name || '',
      email: userData.email || '',
      phone: userData.phone || '',
      address: userData.address || '',
      city: userData.city || '',
      paymentMethod: userData.paymentMethod || 'Cash on Delivery'
    }));
  },

  // --- Dynamic Products from Firestore ---
  subscribeProducts(callback) {
    const colRef = collection(db, 'products');
    return onSnapshot(colRef, (snapshot) => {
      const products = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      callback(products);
    }, (error) => {
      console.error('Products listener error:', error);
      // Fallback: try one-time getDocs
      this.getProducts().then(callback).catch(() => callback([]));
    });
  },

  async getProducts() {
    try {
      const snap = await getDocs(collection(db, 'products'));
      return snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
    } catch (err) {
      console.error('Error fetching products:', err);
      return [];
    }
  },

  async getProduct(productId) {
    if (!productId) return null;
    try {
      const snap = await getDoc(doc(db, 'products', productId));
      if (snap.exists()) {
        return { id: snap.id, ...snap.data() };
      }
    } catch (e) {
      console.warn('Error getProduct:', e);
    }
    return null;
  },

  async addProduct(productData) {
    const colRef = collection(db, 'products');
    const docData = {
      ...productData,
      status: productData.status || 'Active',
      isNew: true,
      stock: Number(productData.stock) || 0,
      price: Number(productData.price) || 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    const ref = await addDoc(colRef, docData);
    return { id: ref.id, ...docData };
  },

  async updateProduct(productId, updates) {
    const ref = doc(db, 'products', productId);
    await updateDoc(ref, {
      ...updates,
      updatedAt: serverTimestamp()
    });
  },

  async deleteProduct(productId) {
    await deleteDoc(doc(db, 'products', productId));
  },

  async decrementStock(productId, quantity) {
    try {
      const prod = await this.getProduct(productId);
      if (prod) {
        const newStock = Math.max(0, (Number(prod.stock) || 0) - Number(quantity));
        await updateDoc(doc(db, 'products', productId), {
          stock: newStock,
          updatedAt: serverTimestamp()
        });
      }
    } catch (e) {
      console.warn('Stock decrement warning for', productId, e.message);
    }
  },

  // --- Seller Profiles & GCash Accounts ---
  async getSeller(sellerId) {
    if (!sellerId) return null;
    try {
      const snap = await getDoc(doc(db, 'sellers', sellerId));
      if (snap.exists()) {
        return { id: snap.id, ...snap.data() };
      }
    } catch (err) {
      console.warn('Error fetching seller:', err.message);
    }
    return null;
  },

  subscribeSellers(callback) {
    return onSnapshot(collection(db, 'sellers'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(list);
    }, (err) => {
      console.warn('Sellers listener warning:', err);
    });
  },

  async saveSellerProfile(sellerId, sellerData) {
    const ref = doc(db, 'sellers', sellerId);
    await setDoc(ref, {
      ...sellerData,
      updatedAt: serverTimestamp()
    }, { merge: true });
  },

  // --- Seller Applications ---
  async submitSellerApplication(appData) {
    const colRef = collection(db, 'seller_applications');
    const payload = {
      ...appData,
      status: 'pending',
      createdAt: serverTimestamp()
    };
    const ref = await addDoc(colRef, payload);

    // Update user document sellerStatus to pending
    if (appData.userId) {
      await updateDoc(doc(db, 'users', appData.userId), {
        sellerStatus: 'pending',
        pendingShopName: appData.shopName || '',
        updatedAt: serverTimestamp()
      }).catch(err => console.warn('Could not update user sellerStatus:', err.message));

      const localUser = this.getLocalUser();
      if (localUser && localUser.uid === appData.userId) {
        localUser.sellerStatus = 'pending';
        localUser.pendingShopName = appData.shopName || '';
        this._saveLocalSession(localUser);
      }
    }

    return { id: ref.id, ...payload };
  },

  subscribeSellerApplications(callback) {
    return onSnapshot(collection(db, 'seller_applications'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(list);
    }, (err) => {
      console.warn('Seller applications listener warning:', err);
    });
  },

  async approveSellerApplication(appId, application) {
    // 1. Update application doc
    await updateDoc(doc(db, 'seller_applications', appId), {
      status: 'approved',
      reviewedAt: serverTimestamp()
    });

    const userId = application.userId;

    // 2. Register/activate in sellers collection
    const sellerPayload = {
      id: userId,
      uid: userId,
      name: application.applicantName || application.name || 'Artisan Seller',
      shopName: application.shopName || 'Artisan Shop',
      category: application.category || 'General',
      email: application.email,
      phone: application.phone || '',
      gcashName: application.gcashName || application.applicantName || '',
      gcashNumber: application.gcashNumber || application.phone || '',
      status: 'Active',
      approvedAt: serverTimestamp()
    };
    await setDoc(doc(db, 'sellers', userId), sellerPayload);

    // 3. Update user role to seller and sellerStatus to approved
    await updateDoc(doc(db, 'users', userId), {
      role: 'seller',
      sellerStatus: 'approved',
      shopName: application.shopName || 'Artisan Shop',
      sellerId: userId,
      updatedAt: serverTimestamp()
    }).catch(e => console.warn('User role update warning:', e.message));

    // 4. Send official password setup / reset email via Firebase Auth
    let emailSent = false;
    if (application.email) {
      try {
        await sendPasswordResetEmail(auth, application.email);
        emailSent = true;
      } catch (emailErr) {
        console.warn('Password setup email dispatch info:', emailErr.message);
      }
    }

    // 5. Send notification to the user
    await addDoc(collection(db, 'notifications'), {
      userId,
      recipientEmail: application.email,
      title: 'Seller Application Approved!',
      message: `Congratulations! Your seller application for "${application.shopName}" has been approved. A secure password setup link has been emailed to ${application.email}. Log in to access your Seller Portal.`,
      type: 'seller_approval',
      read: false,
      createdAt: serverTimestamp()
    });

    return { success: true, emailSent };
  },

  async rejectSellerApplication(appId, application, reason) {
    await updateDoc(doc(db, 'seller_applications', appId), {
      status: 'rejected',
      rejectionReason: reason || 'Information provided did not meet seller criteria.',
      reviewedAt: serverTimestamp()
    });

    const userId = application.userId;
    if (userId) {
      await updateDoc(doc(db, 'users', userId), {
        sellerStatus: 'rejected',
        sellerRejectionReason: reason || 'Requirements not met.',
        updatedAt: serverTimestamp()
      }).catch(e => console.warn('User status update warning:', e));

      await addDoc(collection(db, 'notifications'), {
        userId,
        recipientEmail: application.email,
        title: 'Seller Application Update',
        message: `Your seller application for "${application.shopName}" was not approved. Reason: ${reason || 'Criteria not met.'} You may update your profile and re-apply anytime.`,
        type: 'seller_rejection',
        read: false,
        createdAt: serverTimestamp()
      });
    }
    return { success: true };
  },

  // --- Orders & Payments ---
  async createOrder(orderPayload) {
    const colRef = collection(db, 'orders');
    const orderDoc = {
      ...orderPayload,
      orderNumber: orderPayload.orderNumber || `#ORD-${String(Date.now()).slice(-6)}`,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const docRef = await addDoc(colRef, orderDoc);
    const orderId = docRef.id;

    // Decrement stock in Firestore for all purchased items
    if (Array.isArray(orderPayload.items)) {
      for (const item of orderPayload.items) {
        if (item.productId) {
          await this.decrementStock(item.productId, item.quantity);
        }
      }
    }

    // Create notifications for Customer and Seller(s)
    const totalFormatted = `₱${Number(orderPayload.total || 0).toLocaleString()}.00`;
    if (orderPayload.userId) {
      await addDoc(collection(db, 'notifications'), {
        userId: orderPayload.userId,
        title: orderPayload.paymentStatus === 'Paid' ? 'Order Confirmed & Paid' : 'Order Placed',
        message: `Your order ${orderDoc.orderNumber} for ${totalFormatted} has been placed. Payment: ${orderPayload.paymentMethod} (${orderPayload.paymentStatus}).`,
        orderId,
        read: false,
        createdAt: serverTimestamp()
      }).catch(e => console.warn('Customer notif warning:', e));
    }

    if (Array.isArray(orderPayload.sellerIds)) {
      for (const sId of orderPayload.sellerIds) {
        if (sId) {
          await addDoc(collection(db, 'notifications'), {
            userId: sId,
            sellerId: sId,
            title: 'New Order Received',
            message: `New order ${orderDoc.orderNumber} placed by ${orderPayload.customerName} for ${totalFormatted}. Status: ${orderPayload.orderStatus}.`,
            orderId,
            read: false,
            createdAt: serverTimestamp()
          }).catch(e => console.warn('Seller notif warning:', e));
        }
      }
    }

    return { id: orderId, ...orderDoc };
  },

  subscribeUserOrders(userId, callback) {
    if (!userId) {
      callback([]);
      return () => {};
    }
    const q = query(collection(db, 'orders'), where('userId', '==', userId));
    return onSnapshot(q, (snap) => {
      const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort newest first
      orders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      callback(orders);
    }, (err) => {
      console.warn('User orders snapshot warning:', err);
      // Fallback
      getDocs(q).then(snap => {
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(orders);
      }).catch(() => callback([]));
    });
  },

  subscribeSellerOrders(sellerId, callback) {
    if (!sellerId) {
      callback([]);
      return () => {};
    }
    const q = query(collection(db, 'orders'), where('sellerIds', 'array-contains', sellerId));
    return onSnapshot(q, (snap) => {
      const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      orders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      callback(orders);
    }, (err) => {
      console.warn('Seller orders snapshot warning:', err);
      callback([]);
    });
  },

  subscribeAllOrders(callback) {
    return onSnapshot(collection(db, 'orders'), (snap) => {
      const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      orders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      callback(orders);
    }, (err) => {
      console.warn('All orders snapshot warning:', err);
    });
  },

  async updateOrderStatus(orderId, orderStatus, paymentStatus) {
    const updates = { updatedAt: serverTimestamp() };
    if (orderStatus) updates.orderStatus = orderStatus;
    if (paymentStatus) updates.paymentStatus = paymentStatus;
    await updateDoc(doc(db, 'orders', orderId), updates);
  },

  // --- Notifications ---
  subscribeNotifications(userId, callback) {
    if (!userId) {
      callback([]);
      return () => {};
    }
    const q = query(collection(db, 'notifications'), where('userId', '==', userId));
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      callback(list);
    }, (err) => {
      console.warn('Notifications snapshot warning:', err);
      callback([]);
    });
  }
};

window.ArtisanDB = ArtisanDB;

console.log("ArtisanAisle Firebase backend initialized successfully.");