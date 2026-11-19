/* ── Boot ────────────────────────────────────────────────── */
(async function boot(){
  const config = loadConfig();

  if (!isFirebaseConfigured(config)){
    console.warn('[StudentOS] Firebase not configured — running in local demo mode.');
    try { await initFirebase(config).catch(() => {}); } catch {}
    const demoUser = {
      uid: 'demo-user',
      email: 'demo@studentos.local',
      displayName: 'Demo Student',
      photoURL: '',
      real: false
    };
    try { await onUserSignedIn(demoUser); }
    catch (e){ console.error(e); showAuthScreen(); }
    $('#boot').classList.add('gone');
    return;
  }

  try {
    await initFirebase(config);
  } catch (e){
    console.error('Firebase init failed', e);
    $('#boot').classList.add('gone');
    showAuthScreen();
    const errBox = $('#google-error');
    if (errBox){
      errBox.textContent = `Could not initialise Firebase: ${e.message}`;
      errBox.hidden = false;
    }
    return;
  }

  const enterBtn = $('#enter-btn');
  if (enterBtn) enterBtn.addEventListener('click', signInWithGoogle);

  const demoBtn = $('#demo-btn');
  if (demoBtn) demoBtn.addEventListener('click', async () => {
    const demoUser = {
      uid: 'demo-user',
      email: 'demo@studentos.local',
      displayName: 'Demo Student',
      photoURL: '',
      real: false
    };
    await onUserSignedIn(demoUser);
  });

  GoogleServices.restore();

  FB.mod.onAuthStateChanged(FB.auth, async (user) => {
    if (user){
      user.real = true;
      try {
        await onUserSignedIn(user);
      } catch (e){
        console.error('Sign-in setup failed', e);
        toast('Could not load your data. Check the console.', 'error', 'Sign-in error');
      }
    } else {
      showAuthScreen();
    }
  });

  const menuBtn = $('#menu-btn');
  const sidebar = $('#sidebar');
  const scrim = $('#scrim');
  if (menuBtn && sidebar && scrim){
    menuBtn.addEventListener('click', () => {
      sidebar.classList.add('open');
      scrim.hidden = false;
      menuBtn.setAttribute('aria-expanded', 'true');
    });
    scrim.addEventListener('click', () => {
      sidebar.classList.remove('open');
      scrim.hidden = true;
      menuBtn.setAttribute('aria-expanded', 'false');
    });
  }

  const syncBtn = $('#sync-btn');
  if (syncBtn){
    syncBtn.addEventListener('click', async () => {
      if (!GoogleServices.has()){
        syncBtn.classList.add('busy');
        syncBtn.disabled = true;
        const ok = await ensureGoogleToken();
        syncBtn.classList.remove('busy');
        syncBtn.disabled = false;
        if (!ok){
          toast('Could not reconnect to Google. Sign out and back in.', 'error');
          return;
        }
      }
      syncBtn.classList.add('busy');
      syncBtn.disabled = true;
      try { await syncAll({ silent: false }); }
      finally {
        syncBtn.classList.remove('busy');
        syncBtn.disabled = false;
      }
    });
  }

  const notifBtn = $('#notif-btn');
  const notifPanel = $('#notif-panel');
  if (notifBtn && notifPanel){
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willShow = notifPanel.hidden;
      notifPanel.hidden = !willShow;
      if (willShow) renderNotifPanel();
      notifBtn.setAttribute('aria-expanded', String(willShow));
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown')) notifPanel.hidden = true;
    });
  }

  const accountBtn = $('#account-btn');
  const accountPanel = $('#account-panel');
  if (accountBtn && accountPanel){
    accountBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      accountPanel.hidden = !accountPanel.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown')) accountPanel.hidden = true;
    });
    accountPanel.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        location.hash = btn.dataset.nav;
        accountPanel.hidden = true;
      });
    });
  }

  const signoutBtn = $('#signout-btn');
  if (signoutBtn) signoutBtn.addEventListener('click', signOut);

  window.addEventListener('hashchange', () => {
    render();
    if (window.innerWidth < 900){
      sidebar?.classList.remove('open');
      if (scrim) scrim.hidden = true;
    }
  });

  bindGlobalSearch();

  setInterval(() => {
    if (Store.cache) checkDueSoon();
  }, 5 * 60 * 1000);

  setInterval(() => {
    if (GoogleServices.has() && !syncing) syncAll({ silent: true });
  }, 15 * 60 * 1000);

  setTimeout(() => $('#boot').classList.add('gone'), 400);
})();
