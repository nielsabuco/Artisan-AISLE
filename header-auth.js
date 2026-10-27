const loginLink = document.getElementById('loginButton');

if (loginLink && window.firebaseApi) {
    await window.firebaseApi.authReady;
    const profile = JSON.parse(localStorage.getItem('handicraft_logged_in_user') || 'null');
    const user = window.firebaseApi.currentUser;
    const fullName = profile?.firstName || profile?.firstname || profile?.name || user?.displayName || '';
    const firstName = fullName.trim().split(/\s+/)[0] || user?.email?.split('@')[0] || 'Account';

    if (user || profile) {
        loginLink.textContent = `👤 ${firstName}`;
        loginLink.href = 'index.html';
    }
}
