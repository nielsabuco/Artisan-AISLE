import './styles.css';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  updatePassword,
  GoogleAuthProvider,
  signInWithPopup
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
  authReady: Promise.resolve(),
  get currentUser() {
    return auth.currentUser;
  },
  db,

  // --- Auth & Users ---
  async registerUser(name, email, phone, password) {
    const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    const user = cred.user;
    if (name) {
      await updateProfile(user, { displayName: name }).catch(() => {});
    }

    const isEmailAdmin = this.isEmailAdmin(email);
    const userData = {
      uid: user.uid,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      role: isEmailAdmin ? 'admin' : 'user', // Default account role is user unless admin email
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

  isEmailAdmin(email) {
    if (!email) return false;
    const clean = String(email).trim().toLowerCase();
    const adminEmails = [
      'nielsabuco2006@gmail.com',
      'reniel.sabuco@ssu.edu.ph',
      'admin@artisan.com',
      'admin@artisanaisle.com'
    ];
    if (adminEmails.includes(clean)) return true;
    if (clean.startsWith('admin@')) return true;
    if (clean.includes('admin') && (clean.endsWith('@artisan.com') || clean.endsWith('@artisanaisle.com'))) return true;
    return false;
  },

  async checkIsAdmin(userOrUid) {
    if (!userOrUid) return false;
    let uid = typeof userOrUid === 'string' ? userOrUid : userOrUid.uid;
    let email = (typeof userOrUid === 'object' && userOrUid.email) ? userOrUid.email : '';

    // 1. Check Firebase Auth token claims
    try {
      const authUser = auth.currentUser;
      if (authUser && (!uid || authUser.uid === uid)) {
        if (!email && authUser.email) email = authUser.email;
        const token = await authUser.getIdTokenResult().catch(() => null);
        if (token && token.claims) {
          if (token.claims.admin === true || 
              String(token.claims.role || '').toLowerCase() === 'admin' ||
              String(token.claims.adminRole || '').toLowerCase() === 'admin') {
            return true;
          }
        }
      }
    } catch (e) {}

    // 2. Check admin email rules
    if (this.isEmailAdmin(email)) return true;

    // 3. Check Firestore user document
    if (uid) {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
          const data = snap.data();
          const r = String(data.role || data.Role || '').trim().toLowerCase();
          if (r === 'admin' || data.isAdmin === true || data.is_admin === true) {
            return true;
          }
          if (this.isEmailAdmin(data.email)) return true;
        }
      } catch (e) {}
    }

    // 4. Check passed object
    if (typeof userOrUid === 'object') {
      const r = String(userOrUid.role || userOrUid.Role || '').trim().toLowerCase();
      if (r === 'admin' || userOrUid.isAdmin === true) return true;
      if (this.isEmailAdmin(userOrUid.email)) return true;
    }

    // 5. Check pre-authorized admin records
    if (email) {
      try {
        const authSnap = await getDoc(doc(db, 'admin_authorizations', email.toLowerCase().trim()));
        if (authSnap.exists()) return true;
      } catch (e) {}
    }

    return false;
  },

  async loginUser(email, password) {
    const cleanEmail = email.trim().toLowerCase();
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      const user = cred.user;
      let profile = await this.getUserProfile(user.uid);
      let sessionData = profile || {
        uid: user.uid,
        name: user.displayName || cleanEmail.split('@')[0],
        email: user.email,
        phone: '',
        role: 'user',
        sellerStatus: 'none'
      };

      if (this.isEmailAdmin(user.email) || String(sessionData.role || '').toLowerCase() === 'admin') {
        sessionData.role = 'admin';
        this.updateUserRole(user.uid, 'admin').catch(() => {});
      }

      this._saveLocalSession(sessionData);
      return sessionData;
    } catch (authErr) {
      // Check if user was approved as seller with a generated temporary password
      try {
        const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const userDoc = snap.docs[0];
          const userData = userDoc.data();
          if (userData.mustChangePassword && userData.temporaryPassword && userData.temporaryPassword === password) {
            // Legal temporary password recognized!
            const sessionData = {
              uid: userDoc.id,
              id: userDoc.id,
              ...userData,
              email: cleanEmail,
              mustChangePassword: true,
              role: userData.role || 'seller',
              sellerStatus: userData.sellerStatus || 'approved'
            };
            this._saveLocalSession(sessionData);
            return sessionData;
          }
        }
      } catch (checkErr) {
        console.warn('Temporary password verification check warning:', checkErr);
      }
      throw authErr;
    }
  },

  async loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    const user = cred.user;

    const email = (user.email || '').trim().toLowerCase();
    const isAdmin = this.isEmailAdmin(email);

    // Check if user profile already exists in Firestore
    let profile = await this.getUserProfile(user.uid);
    if (!profile) {
      // First-time Google login: create profile document
      const displayName = user.displayName || (email ? email.split('@')[0] : 'Artisan Customer');
      profile = {
        uid: user.uid,
        name: displayName,
        email: email,
        phone: user.phoneNumber || '',
        avatar: user.photoURL || '',
        role: isAdmin ? 'admin' : 'user', // Automatically Admin if email rule matches
        sellerStatus: 'none', // none | pending | approved | rejected
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      try {
        await setDoc(doc(db, 'users', user.uid), profile);
      } catch (err) {
        console.warn('Firestore set user warning on Google login:', err.message);
      }
    } else {
      if (isAdmin && profile.role !== 'admin') {
        profile.role = 'admin';
        this.updateUserRole(user.uid, 'admin').catch(() => {});
      }
      // Existing profile: update avatar if available and not set
      if (!profile.avatar && user.photoURL) {
        try {
          await updateDoc(doc(db, 'users', user.uid), {
            avatar: user.photoURL,
            updatedAt: serverTimestamp()
          });
          profile.avatar = user.photoURL;
        } catch (e) {}
      }
    }

    this._saveLocalSession(profile);
    return profile;
  },

  async signInWithGoogle() {
    return this.loginWithGoogle();
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
        const data = snap.data();
        let role = String(data.role || data.Role || '').trim().toLowerCase();
        const isAdmin = role === 'admin' || data.isAdmin === true || data.is_admin === true || this.isEmailAdmin(data.email);

        if (isAdmin) {
          role = 'admin';
          // Ensure persisted in Firestore if it was stored as 'Admin' or not marked yet
          if (data.role !== 'admin') {
            updateDoc(doc(db, 'users', uid), { role: 'admin' }).catch(() => {});
          }
        } else if (role === 'seller' || String(data.sellerStatus || '').toLowerCase() === 'approved') {
          role = 'seller';
        } else {
          role = role || 'user';
        }

        return { id: snap.id, ...data, role };
      }
    } catch (err) {
      console.warn('Error fetching user profile from Firestore:', err.message);
    }
    return this.getLocalUser();
  },

  async updateUserProfile(uid, data) {
    if (!uid) return;
    try {
      if (auth.currentUser && auth.currentUser.uid === uid) {
        const authUpdates = {};
        if (data.name) authUpdates.displayName = data.name;
        const photo = data.photoURL || data.avatar;
        if (photo && photo.startsWith('http')) {
          authUpdates.photoURL = photo;
        }
        if (Object.keys(authUpdates).length > 0) {
          await updateProfile(auth.currentUser, authUpdates).catch(() => {});
        }
      }

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
        let isTokenAdmin = false;
        try {
          const token = await user.getIdTokenResult();
          if (token && token.claims) {
            if (token.claims.admin === true || String(token.claims.role || '').toLowerCase() === 'admin') {
              isTokenAdmin = true;
            }
          }
        } catch (e) {}

        const profile = await this.getUserProfile(user.uid);

        // Security check: If newly approved seller must change password and is on a non-login page, log them out
        if (profile?.mustChangePassword && !window.location.pathname.includes('login.html')) {
          await signOut(auth).catch(() => {});
          localStorage.removeItem('handicraft_logged_in_user');
          localStorage.removeItem('handicraft_profile');
          window.location.href = `login.html?sellerApproved=true&email=${encodeURIComponent(user.email || '')}`;
          return;
        }

        let activeUser = profile || {
          uid: user.uid,
          name: user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
          email: user.email,
          role: 'user',
          sellerStatus: 'none'
        };

        const email = activeUser.email || (user.email || '');
        const rawRole = String(activeUser.role || activeUser.Role || '').trim().toLowerCase();

        if (isTokenAdmin || rawRole === 'admin' || activeUser.isAdmin === true || this.isEmailAdmin(email)) {
          activeUser.role = 'admin';
          if (profile && profile.role !== 'admin') {
            updateDoc(doc(db, 'users', user.uid), { role: 'admin' }).catch(() => {});
          }
        } else if (rawRole === 'seller' || String(activeUser.sellerStatus || '').toLowerCase() === 'approved') {
          activeUser.role = 'seller';
        } else {
          activeUser.role = rawRole || 'user';
        }

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

  async getSellers() {
    try {
      const snap = await getDocs(collection(db, 'sellers'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('Error fetching sellers:', err);
      return [];
    }
  },

  async createArtisan(artisanData) {
    const col = collection(db, 'sellers');
    const docRef = await addDoc(col, {
      ...artisanData,
      status: artisanData.status || 'Active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return { id: docRef.id, ...artisanData };
  },

  async deleteArtisan(sellerId) {
    if (!sellerId) return;
    await deleteDoc(doc(db, 'sellers', sellerId));
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

  async sendPasswordReset(email) {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail) throw new Error('Please enter a valid email address.');
    const actionCodeSettings = {
      url: `${window.location.origin}/login.html?email=${encodeURIComponent(cleanEmail)}`,
      handleCodeInApp: false
    };
    await sendPasswordResetEmail(auth, cleanEmail, actionCodeSettings);
    return { success: true };
  },

  async approveSellerApplication(appId, application) {
    // 1. Update application doc
    await updateDoc(doc(db, 'seller_applications', appId), {
      status: 'approved',
      reviewedAt: serverTimestamp()
    });

    const userId = application.userId;
    const cleanEmail = (application.email || '').trim().toLowerCase();

    // 2. Generate secure temporary password for seller onboarding
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const temporaryPassword = `Artisan#${randomDigits}`;
    const loginUrl = `${window.location.origin}/login.html?sellerApproved=true&email=${encodeURIComponent(cleanEmail)}`;

    // 3. Register/activate in sellers collection
    const sellerPayload = {
      id: userId,
      uid: userId,
      name: application.applicantName || application.name || 'Artisan Seller',
      shopName: application.shopName || 'Artisan Shop',
      category: application.category || 'General',
      email: cleanEmail,
      phone: application.phone || '',
      gcashName: application.gcashName || application.applicantName || '',
      gcashNumber: application.gcashNumber || application.phone || '',
      status: 'Active',
      approvedAt: serverTimestamp()
    };
    await setDoc(doc(db, 'sellers', userId), sellerPayload);

    // 4. Update user role, sellerStatus, and require password change
    let targetRole = 'seller';
    try {
      const existingProfile = await this.getUserProfile(userId);
      if (existingProfile && (existingProfile.role === 'admin' || this.isEmailAdmin(cleanEmail))) {
        targetRole = 'admin';
      }
    } catch (e) {}

    await updateDoc(doc(db, 'users', userId), {
      role: targetRole,
      sellerStatus: 'approved',
      shopName: application.shopName || 'Artisan Shop',
      sellerId: userId,
      mustChangePassword: true,
      temporaryPassword: temporaryPassword,
      approvalEmailSentTo: cleanEmail,
      updatedAt: serverTimestamp()
    }).catch(e => console.warn('User role update warning:', e.message));

    // 5. Send auto-generated email via serverless route /api/send-seller-email
    let autoEmailDispatched = false;
    let autoEmailError = null;
    try {
      const emailRes = await fetch('/api/send-seller-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: cleanEmail,
          applicantName: application.applicantName || application.name || 'Artisan Partner',
          shopName: application.shopName || 'Your Artisan Shop',
          temporaryPassword,
          loginUrl
        })
      });
      if (emailRes.ok) {
        autoEmailDispatched = true;
      } else {
        const errJson = await emailRes.json().catch(() => ({}));
        autoEmailError = errJson.error || 'Server returned status ' + emailRes.status;
      }
    } catch (apiErr) {
      autoEmailError = apiErr.message;
      console.warn('API seller email dispatch info:', apiErr);
    }

    // Record in Firestore sent_emails collection for audit logging
    await addDoc(collection(db, 'sent_emails'), {
      type: 'seller_approval_credentials',
      to: cleanEmail,
      applicantName: application.applicantName || application.name || 'Artisan Seller',
      shopName: application.shopName || 'Artisan Shop',
      temporaryPassword,
      loginUrl,
      dispatchedAt: serverTimestamp(),
      status: autoEmailDispatched ? 'Delivered' : 'Recorded'
    }).catch(() => {});

    // 6. Also dispatch official Firebase Auth password setup email as an alternate security link
    let firebaseEmailSent = false;
    if (cleanEmail) {
      try {
        const actionCodeSettings = {
          url: `${window.location.origin}/login.html?sellerApproved=true&email=${encodeURIComponent(cleanEmail)}`,
          handleCodeInApp: false
        };
        await sendPasswordResetEmail(auth, cleanEmail, actionCodeSettings);
        firebaseEmailSent = true;
      } catch (emailErr) {
        console.warn('Password setup email dispatch info:', emailErr);
      }
    }

    // 7. Send notification to the user in Firestore
    await addDoc(collection(db, 'notifications'), {
      userId,
      recipientEmail: cleanEmail,
      title: '🎉 Seller Application Approved!',
      message: `Congratulations! Your seller application for "${application.shopName}" has been approved. Your seller portal is now active. Please use the temporary credentials sent to ${cleanEmail} to log in and set your new permanent password.`,
      type: 'seller_approval',
      read: false,
      createdAt: serverTimestamp()
    }).catch(() => {});

    return {
      success: true,
      emailSent: autoEmailDispatched || firebaseEmailSent,
      autoEmailDispatched,
      firebaseEmailSent,
      temporaryPassword,
      cleanEmail,
      loginUrl,
      shopName: application.shopName || 'Artisan Shop',
      applicantName: application.applicantName || application.name || 'Artisan Partner'
    };
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

  async revokeSellerAccess(userId, userEmail) {
    if (!userId) throw new Error('User ID is required');

    // 1. Update user record
    await updateDoc(doc(db, 'users', userId), {
      role: 'user',
      sellerStatus: 'revoked',
      sellerRevokedAt: serverTimestamp()
    }).catch(e => console.warn('User revoke warning:', e));

    // 2. Update seller profile if exists
    try {
      await updateDoc(doc(db, 'sellers', userId), {
        status: 'revoked',
        updatedAt: serverTimestamp()
      });
    } catch (e) {}

    // 3. Deactivate products listed by this seller so they no longer appear on storefront
    let updatedProductsCount = 0;
    try {
      const q = query(collection(db, 'products'), where('sellerId', '==', userId));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        await updateDoc(d.ref, { status: 'Inactive', updatedAt: serverTimestamp() });
        updatedProductsCount++;
      }

      if (userEmail) {
        const q2 = query(collection(db, 'products'), where('sellerEmail', '==', userEmail.toLowerCase()));
        const snap2 = await getDocs(q2);
        for (const d of snap2.docs) {
          await updateDoc(d.ref, { status: 'Inactive', updatedAt: serverTimestamp() });
          updatedProductsCount++;
        }
      }
    } catch (e) {
      console.warn('Deactivating products warning:', e);
    }

    // 4. Send notification
    await addDoc(collection(db, 'notifications'), {
      userId,
      recipientEmail: userEmail || '',
      title: 'Seller Access Revoked',
      message: 'Your seller privileges have been revoked by the administration. Your listed products have been set to Inactive.',
      type: 'seller_revoked',
      read: false,
      createdAt: serverTimestamp()
    }).catch(() => {});

    return { success: true, updatedProductsCount };
  },

  async suspendSeller(userId, userEmail, reason = 'Account under policy review.') {
    if (!userId) throw new Error('User ID is required');

    // 1. Update user record
    await updateDoc(doc(db, 'users', userId), {
      sellerStatus: 'suspended',
      isSuspended: true,
      sellerSuspendReason: reason,
      sellerSuspendedAt: serverTimestamp()
    });

    // 2. Update seller doc
    try {
      await updateDoc(doc(db, 'sellers', userId), {
        status: 'suspended',
        suspendReason: reason,
        updatedAt: serverTimestamp()
      });
    } catch (e) {}

    // 3. Set their products to Suspended
    let affectedProducts = 0;
    try {
      const q = query(collection(db, 'products'), where('sellerId', '==', userId));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        await updateDoc(d.ref, { status: 'Suspended', updatedAt: serverTimestamp() });
        affectedProducts++;
      }

      if (userEmail) {
        const q2 = query(collection(db, 'products'), where('sellerEmail', '==', userEmail.toLowerCase()));
        const snap2 = await getDocs(q2);
        for (const d of snap2.docs) {
          await updateDoc(d.ref, { status: 'Suspended', updatedAt: serverTimestamp() });
          affectedProducts++;
        }
      }
    } catch (e) {
      console.warn('Suspending seller products warning:', e);
    }

    // 4. Send notification
    await addDoc(collection(db, 'notifications'), {
      userId,
      recipientEmail: userEmail || '',
      title: 'Seller Account Suspended',
      message: `Your seller privileges have been temporarily suspended. Reason: ${reason}. Please contact platform support for resolution.`,
      type: 'seller_suspended',
      read: false,
      createdAt: serverTimestamp()
    }).catch(() => {});

    return { success: true, affectedProducts };
  },

  async unsuspendSeller(userId, userEmail) {
    if (!userId) throw new Error('User ID is required');

    await updateDoc(doc(db, 'users', userId), {
      sellerStatus: 'approved',
      isSuspended: false,
      sellerSuspendReason: null,
      sellerSuspendedAt: null,
      updatedAt: serverTimestamp()
    });

    try {
      await updateDoc(doc(db, 'sellers', userId), {
        status: 'approved',
        updatedAt: serverTimestamp()
      });
    } catch (e) {}

    // Restore products to Active
    let restoredProducts = 0;
    try {
      const q = query(collection(db, 'products'), where('sellerId', '==', userId));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        await updateDoc(d.ref, { status: 'Active', updatedAt: serverTimestamp() });
        restoredProducts++;
      }

      if (userEmail) {
        const q2 = query(collection(db, 'products'), where('sellerEmail', '==', userEmail.toLowerCase()));
        const snap2 = await getDocs(q2);
        for (const d of snap2.docs) {
          await updateDoc(d.ref, { status: 'Active', updatedAt: serverTimestamp() });
          restoredProducts++;
        }
      }
    } catch (e) {
      console.warn('Restoring seller products warning:', e);
    }

    await addDoc(collection(db, 'notifications'), {
      userId,
      recipientEmail: userEmail || '',
      title: 'Seller Account Reactivated',
      message: 'Your seller privileges have been restored by the administration. Your products are active once again.',
      type: 'seller_reactivated',
      read: false,
      createdAt: serverTimestamp()
    }).catch(() => {});

    return { success: true, restoredProducts };
  },

  async deleteSellerAndProducts(userId, userEmail) {
    if (!userId) throw new Error('User ID is required');

    let deletedProductsCount = 0;
    const deletedProductIds = new Set();

    // 1. Delete all products listed by this seller by sellerId
    try {
      const q1 = query(collection(db, 'products'), where('sellerId', '==', userId));
      const snap1 = await getDocs(q1);
      for (const d of snap1.docs) {
        if (!deletedProductIds.has(d.id)) {
          deletedProductIds.add(d.id);
          await deleteDoc(d.ref);
          deletedProductsCount++;
        }
      }
    } catch (e) {
      console.warn('Error deleting products by sellerId:', e);
    }

    // 2. Delete all products listed by this seller by sellerEmail
    if (userEmail) {
      try {
        const q2 = query(collection(db, 'products'), where('sellerEmail', '==', userEmail.toLowerCase()));
        const snap2 = await getDocs(q2);
        for (const d of snap2.docs) {
          if (!deletedProductIds.has(d.id)) {
            deletedProductIds.add(d.id);
            await deleteDoc(d.ref);
            deletedProductsCount++;
          }
        }
      } catch (e) {
        console.warn('Error deleting products by sellerEmail:', e);
      }
    }

    // 3. Delete from 'sellers' collection
    try {
      await deleteDoc(doc(db, 'sellers', userId));
    } catch (e) {}

    // 4. Delete user document from 'users' collection (or mark deleted)
    try {
      await deleteDoc(doc(db, 'users', userId));
    } catch (e) {
      await updateDoc(doc(db, 'users', userId), {
        role: 'user',
        sellerStatus: 'deleted',
        isDeleted: true,
        updatedAt: serverTimestamp()
      }).catch(() => {});
    }

    // 5. Delete any pending or reviewed applications from this user
    try {
      const appQ = query(collection(db, 'seller_applications'), where('userId', '==', userId));
      const appSnap = await getDocs(appQ);
      for (const a of appSnap.docs) {
        await deleteDoc(a.ref);
      }
    } catch (e) {}

    return {
      success: true,
      deletedProductsCount
    };
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

  async updateOrder(orderId, updateFields) {
    if (!orderId) return;
    await updateDoc(doc(db, 'orders', orderId), {
      ...updateFields,
      updatedAt: serverTimestamp()
    });
  },

  async updateOrderTracking(orderId, trackingData) {
    if (!orderId) return;
    const ref = doc(db, 'orders', orderId);
    let existingUpdates = [];
    let userId = null;
    let orderNumber = orderId;
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        existingUpdates = data.trackingUpdates || [];
        userId = data.userId;
        orderNumber = data.orderNumber || orderId;
      }
    } catch (e) {}

    const newUpdate = {
      status: trackingData.orderStatus || trackingData.trackingStatus || 'Processing',
      location: trackingData.currentLocation || 'Artisan Workshop',
      courier: trackingData.courier || 'Local Logistics',
      trackingNumber: trackingData.trackingNumber || '',
      note: trackingData.trackingNotes || 'Tracking status updated.',
      timestamp: new Date().toISOString()
    };

    const updates = {
      orderStatus: trackingData.orderStatus || 'Processing',
      trackingStatus: trackingData.trackingStatus || trackingData.orderStatus || 'Processing',
      courier: trackingData.courier || '',
      trackingNumber: trackingData.trackingNumber || '',
      currentLocation: trackingData.currentLocation || '',
      trackingNotes: trackingData.trackingNotes || '',
      estimatedDelivery: trackingData.estimatedDelivery || '',
      trackingUpdates: [newUpdate, ...existingUpdates],
      updatedAt: serverTimestamp()
    };

    if (trackingData.paymentStatus) {
      updates.paymentStatus = trackingData.paymentStatus;
    }

    await updateDoc(ref, updates);

    // Notify customer
    if (userId) {
      await addDoc(collection(db, 'notifications'), {
        userId,
        title: `Order Tracking Update: ${orderNumber}`,
        message: `Your order ${orderNumber} tracking updated: ${updates.orderStatus} (${updates.currentLocation || updates.courier || 'In Transit'}).`,
        orderId,
        read: false,
        createdAt: serverTimestamp()
      }).catch(e => console.warn('Customer tracking notif warning:', e));
    }

    return updates;
  },

  // --- Users Management for Admin ---
  subscribeAllUsers(callback) {
    return onSnapshot(collection(db, 'users'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(list);
    }, (err) => {
      console.warn('All users snapshot error:', err);
      this.getAllUsers().then(callback).catch(() => callback([]));
    });
  },

  async getAllUsers() {
    try {
      const snap = await getDocs(collection(db, 'users'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('Error fetching all users:', e);
      return [];
    }
  },

  async updateUserRole(uid, role, sellerStatus) {
    const updates = { role, updatedAt: serverTimestamp() };
    if (sellerStatus) updates.sellerStatus = sellerStatus;
    await updateDoc(doc(db, 'users', uid), updates);
  },

  async promoteUserToAdmin(targetUid, { adminRole = 'super_admin', title, notes, promotedByAdmin } = {}) {
    if (!targetUid) throw new Error("Target user ID is required.");

    const roleTitles = {
      super_admin: 'Super Administrator',
      operations_admin: 'Operations & Logistics Admin',
      moderator_admin: 'Catalog & Artisan Moderator',
      finance_admin: 'Finance & Sales Auditor'
    };

    const finalTitle = title || roleTitles[adminRole] || 'Platform Administrator';
    const promoterName = promotedByAdmin?.name || promotedByAdmin?.email || 'Platform Master Admin';

    const updates = {
      role: 'admin',
      isAdmin: true,
      adminRole: adminRole,
      adminTitle: finalTitle,
      adminPromotedBy: promoterName,
      adminPromotedByEmail: promotedByAdmin?.email || '',
      adminPromotionNotes: notes || '',
      adminPromotedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, 'users', targetUid), updates, { merge: true });

    // Send in-app notification to the newly appointed administrator
    await this.addNotification(targetUid, {
      title: 'Appointed to Administrative Position',
      message: `You have been appointed as ${finalTitle} by ${promoterName}. You now have administrative access to ArtisanAisle.`,
      type: 'admin_promotion'
    }).catch(() => {});

    return updates;
  },

  async demoteAdminToUser(targetUid, newRole = 'user', demotedByAdmin) {
    if (!targetUid) throw new Error("Target user ID is required.");

    // Guard: Prevent demoting primary platform seed admins
    const targetDoc = await this.getUserProfile(targetUid);
    if (targetDoc && this.isEmailAdmin(targetDoc.email)) {
      throw new Error(`Cannot revoke admin status for primary platform owner (${targetDoc.email}).`);
    }

    const demoterName = demotedByAdmin?.name || demotedByAdmin?.email || 'Administrator';
    const updates = {
      role: newRole,
      isAdmin: false,
      adminRole: null,
      adminTitle: null,
      adminDemotedAt: serverTimestamp(),
      adminDemotedBy: demoterName,
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, 'users', targetUid), updates, { merge: true });

    await this.addNotification(targetUid, {
      title: 'Administrative Access Updated',
      message: `Your administrator privileges were changed to ${newRole.toUpperCase()} by ${demoterName}.`,
      type: 'admin_demotion'
    }).catch(() => {});

    return updates;
  },

  async findUserByEmail(email) {
    if (!email) return null;
    const cleanEmail = email.trim().toLowerCase();
    const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return { id: snap.docs[0].id, uid: snap.docs[0].id, ...snap.docs[0].data() };
    }
    return null;
  },

  async promoteUserByEmail(email, promotionData) {
    if (!email) throw new Error("Email address is required.");
    const existing = await this.findUserByEmail(email);
    if (existing) {
      return await this.promoteUserToAdmin(existing.id || existing.uid, promotionData);
    }

    // Pre-authorize admin account if they haven't registered yet
    const cleanEmail = email.trim().toLowerCase();
    const authDocRef = doc(db, 'admin_authorizations', cleanEmail);
    await setDoc(authDocRef, {
      email: cleanEmail,
      adminRole: promotionData.adminRole || 'super_admin',
      adminTitle: promotionData.title || 'Platform Administrator',
      notes: promotionData.notes || '',
      authorizedBy: promotionData.promotedByAdmin?.email || 'Admin',
      createdAt: serverTimestamp()
    });

    return { preAuthorized: true, email: cleanEmail };
  },

  async addNotification(userId, { title, message, type = 'info' }) {
    if (!userId) return;
    try {
      await addDoc(collection(db, 'notifications'), {
        userId,
        title,
        message,
        type,
        read: false,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.warn('Failed to add notification:', e);
    }
  },

  // --- Image Optimization & Upload Helper ---
  async uploadImage(file, maxSize = 1200) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve('');
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = Math.round((height * maxSize) / width);
              width = maxSize;
            } else {
              width = Math.round((width * maxSize) / height);
              height = maxSize;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.85);
          resolve(compressed);
        };
        img.onerror = () => resolve(e.target.result);
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  // --- Client Cart System ---
  getCart() {
    try {
      return JSON.parse(localStorage.getItem('artisan_cart') || '[]');
    } catch (e) {
      return [];
    }
  },

  saveCart(cart) {
    localStorage.setItem('artisan_cart', JSON.stringify(cart));
    window.dispatchEvent(new CustomEvent('artisan-cart-updated', { detail: cart }));
  },

  addToCart(product, quantity = 1) {
    const cart = this.getCart();
    const existingIndex = cart.findIndex(item => item.id === product.id || item.productId === product.id);
    const qty = Math.max(1, Number(quantity) || 1);

    if (existingIndex > -1) {
      const maxStock = Number(cart[existingIndex].stock) || 99;
      cart[existingIndex].quantity = Math.min(maxStock, (Number(cart[existingIndex].quantity) || 1) + qty);
    } else {
      cart.push({
        id: product.id,
        productId: product.id,
        name: product.name || 'Handcrafted Treasure',
        price: Number(product.price) || 0,
        image: product.image || 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=600&q=80',
        sellerId: product.sellerId || '',
        sellerName: product.sellerName || 'Artisan Partner',
        category: product.category || 'General',
        stock: Number(product.stock) || 10,
        quantity: qty
      });
    }

    this.saveCart(cart);
    return cart;
  },

  removeFromCart(productId) {
    let cart = this.getCart();
    cart = cart.filter(item => item.id !== productId && item.productId !== productId);
    this.saveCart(cart);
    return cart;
  },

  updateCartQuantity(productId, quantity) {
    const cart = this.getCart();
    const item = cart.find(i => i.id === productId || i.productId === productId);
    if (item) {
      const maxStock = Number(item.stock) || 99;
      item.quantity = Math.max(1, Math.min(maxStock, Number(quantity) || 1));
      this.saveCart(cart);
    }
    return cart;
  },

  clearCart() {
    localStorage.removeItem('artisan_cart');
    window.dispatchEvent(new CustomEvent('artisan-cart-updated', { detail: [] }));
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
  },

  async getOrder(orderId) {
    if (!orderId) return null;
    try {
      const snap = await getDoc(doc(db, 'orders', orderId));
      if (snap.exists()) return { id: snap.id, ...snap.data() };
    } catch (e) {
      console.warn('Error getOrder:', e);
    }
    return null;
  },

  async sendPasswordReset(email) {
    if (!email) throw new Error('Please enter your email address.');
    const cleanEmail = email.trim().toLowerCase();
    const actionCodeSettings = {
      url: `${window.location.origin}/login.html`,
      handleCodeInApp: false
    };
    await sendPasswordResetEmail(auth, cleanEmail, actionCodeSettings);
    return { success: true, email: cleanEmail };
  },

  async hasUserOrderedProduct(userId, userEmail, productId) {
    if (!productId) return false;
    try {
      const cleanEmail = (userEmail || '').trim().toLowerCase();
      
      // 1. Check orders by userId
      if (userId) {
        const q1 = query(collection(db, 'orders'), where('userId', '==', userId));
        const snap1 = await getDocs(q1);
        for (const docSnap of snap1.docs) {
          const ord = docSnap.data();
          const items = Array.isArray(ord.items) ? ord.items : [];
          if (items.some(item => String(item.id || item.productId) === String(productId))) {
            return true;
          }
        }
      }

      // 2. Check orders by customerEmail
      if (cleanEmail) {
        const q2 = query(collection(db, 'orders'), where('customerEmail', '==', cleanEmail));
        const snap2 = await getDocs(q2);
        for (const docSnap of snap2.docs) {
          const ord = docSnap.data();
          const items = Array.isArray(ord.items) ? ord.items : [];
          if (items.some(item => String(item.id || item.productId) === String(productId))) {
            return true;
          }
        }
      }

      // 3. Fallback: Check local cached orders
      const localOrders = JSON.parse(localStorage.getItem('artisan_local_orders') || '[]');
      for (const ord of localOrders) {
        const items = Array.isArray(ord.items) ? ord.items : [];
        if (items.some(item => String(item.id || item.productId) === String(productId))) {
          return true;
        }
      }
    } catch (err) {
      console.warn('Error checking verified buyer status:', err);
    }
    return false;
  },

  async changePassword(newPassword) {
    if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters.');

    const localUser = this.getLocalUser();
    const uid = auth.currentUser?.uid || localUser?.uid || localUser?.id;

    if (auth.currentUser) {
      // 1. Update in Firebase Auth
      await updatePassword(auth.currentUser, newPassword);
    }

    // 2. Clear mustChangePassword and temporaryPassword in Firestore
    if (uid) {
      await updateDoc(doc(db, 'users', uid), {
        mustChangePassword: false,
        temporaryPassword: null,
        passwordChangedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }).catch(e => console.warn('User doc password flag update warning:', e));
    }

    // 3. Update local cache
    const cached = this.getLocalUser();
    if (cached) {
      cached.mustChangePassword = false;
      delete cached.temporaryPassword;
      localStorage.setItem('handicraft_logged_in_user', JSON.stringify(cached));
      localStorage.setItem('handicraft_profile', JSON.stringify(cached));
    }

    return { success: true };
  },

  async getProductReviews(productId) {
    if (!productId) return [];
    try {
      const q = query(collection(db, 'reviews'), where('productId', '==', productId));
      const snap = await getDocs(q);
      const reviews = [];
      snap.forEach(d => reviews.push({ id: d.id, ...d.data() }));
      return reviews.sort((a, b) => {
        const timeA = a.createdAt?.seconds || (a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0);
        const timeB = b.createdAt?.seconds || (b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0);
        return timeB - timeA;
      });
    } catch (e) {
      console.warn('Error getProductReviews:', e);
      return [];
    }
  },

  async saveReview(reviewData) {
    if (!reviewData.productId) throw new Error('Product ID is required.');

    // Enforce verified buyer requirement
    const reviewerId = reviewData.reviewerId;
    const reviewerEmail = reviewData.reviewerEmail || '';
    if (!reviewerId && !reviewerEmail) {
      throw new Error('Only authenticated customers who purchased this item can leave a review.');
    }

    const hasOrdered = await this.hasUserOrderedProduct(reviewerId, reviewerEmail, reviewData.productId);
    if (!hasOrdered) {
      throw new Error('Verified Buyer Requirement: Reviews are restricted to customers who have ordered this craft on Artisan Aisle.');
    }

    const docRef = await addDoc(collection(db, 'reviews'), {
      ...reviewData,
      rating: Number(reviewData.rating) || 5,
      verifiedPurchase: true,
      createdAt: serverTimestamp()
    });

    // Automatically recalculate and sync product average rating and reviewsCount
    if (reviewData.productId) {
      try {
        const reviews = await this.getProductReviews(reviewData.productId);
        const count = reviews.length;
        const total = reviews.reduce((sum, r) => sum + (Number(r.rating) || 5), 0);
        const avg = count > 0 ? (total / count).toFixed(1) : '5.0';

        await updateDoc(doc(db, 'products', reviewData.productId), {
          rating: Number(avg),
          reviewsCount: count,
          reviews: count
        });
      } catch (e) {
        console.warn('Product rating sync warning:', e);
      }
    }

    return docRef;
  },

  async saveContactMessage(msgData) {
    return await addDoc(collection(db, 'contact_messages'), {
      ...msgData,
      createdAt: serverTimestamp()
    });
  },

  // --- Payment Gateway Settings ---
  async getPaymentSettings() {
    try {
      const snap = await getDoc(doc(db, 'settings', 'payment_gateway'));
      if (snap.exists()) return snap.data();
    } catch (e) {
      console.warn('Could not read payment settings from Firestore:', e);
    }
    return null;
  },

  async updatePaymentSettings(settings) {
    const ref = doc(db, 'settings', 'payment_gateway');
    await setDoc(ref, {
      ...settings,
      updatedAt: serverTimestamp()
    }, { merge: true });
    return { success: true };
  }
};

window.ArtisanDB = ArtisanDB;
window.firebaseApi = ArtisanDB;

console.log("ArtisanAisle Firebase backend initialized successfully.");