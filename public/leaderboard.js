// Leaderboard module: prefers Firestore, falls back to Realtime Database
// Exposes window.Leaderboard: { ready, submitRun(username, timeMs), subscribeTop(cb) }

let ready = false;
let submitRun = async () => { throw new Error('Firebase not configured'); };
let subscribeTop = (cb) => { return () => {}; };
let firstDataRendered = false;
let allRowsCache = []; // full ordered list for rank computation

const formatMs = (ms) => {
  const total = Math.max(0, Math.floor(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const mm = String(m);
  const ss = String(s).padStart(2, '0');
  const ms3 = String(total % 1000).padStart(3, '0');
  return `${mm}:${ss}.${ms3}`;
};

function renderTop(list) {
  const el = document.getElementById('leaderboard-list');
  const usersEl = document.getElementById('users-list');
  if (!el) return;
  el.innerHTML = '';
  // Show a friendly placeholder when there are no rows yet
  if (!Array.isArray(list) || list.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No runs yet — be the first!';
    el.appendChild(li);
    if (usersEl) {
      usersEl.innerHTML = '';
      const u = document.createElement('li');
      u.textContent = 'No users yet';
      usersEl.appendChild(u);
    }
    return;
  }
  list.forEach((row, idx) => {
    const li = document.createElement('li');
    li.textContent = `${idx + 1}. ${row.username} — ${formatMs(row.timeMs)}`;
    li.className = 'lb-item';
    li.style.animationDelay = `${Math.min(idx * 30, 240)}ms`;
    el.appendChild(li);
  });

  // Render Users list (unique usernames from current rows)
  if (usersEl) {
    usersEl.innerHTML = '';
    list.forEach((row, i) => {
      const li = document.createElement('li');
      li.textContent = `${i + 1}. ${row.username}: ${formatMs(row.timeMs)}`;
      usersEl.appendChild(li);
    });
  }
}

function renderTopAndFlag(list) {
  renderTop(list);
  firstDataRendered = true;
}

function renderNeedsConfig() {
  const el = document.getElementById('leaderboard-list');
  if (!el) return;
  el.innerHTML = '';
  const li = document.createElement('li');
  li.textContent = 'Connect Firebase to enable the global leaderboard';
  el.appendChild(li);
}

function renderLoading() {
  const el = document.getElementById('leaderboard-list');
  if (!el) return;
  el.innerHTML = '';
  const li = document.createElement('li');
  li.textContent = 'Loading leaderboard…';
  el.appendChild(li);
}

async function initFirestoreBackend(config) {
  const [{ initializeApp }, { getFirestore, collection, addDoc, serverTimestamp, query, orderBy, limit, onSnapshot, getDocs, where }]
    = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js')
    ]);

  const app = initializeApp(config);
  const db = getFirestore(app);
  const collectionName = (window && window.LEADERBOARD_COLLECTION) ? String(window.LEADERBOARD_COLLECTION) : 'runs';
  const runsRef = collection(db, collectionName);

  subscribeTop = (cb) => {
    // Single-field order avoids requiring a composite index
    const q = query(runsRef, orderBy('timeMs', 'asc'), limit(10));
    // Initial one-time fetch for fast first paint
    getDocs(q).then((snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderTopAndFlag(rows);
    }).catch(() => {});
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        cb(rows);
      },
      (err) => {
        console.warn('Leaderboard listen failed', err);
        renderNeedsConfig();
      }
    );
    return unsub;
  };

  // Full list subscription for cached rank calculation
  try {
    const fullQ = query(runsRef, orderBy('timeMs', 'asc'));
    onSnapshot(fullQ, (snap) => {
      allRowsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }, () => {});
  } catch {}

  submitRun = async (username, timeMs) => {
    const docData = { username: String(username || 'Anonymous').slice(0, 24), timeMs: Math.floor(timeMs), createdAt: serverTimestamp() };
    await addDoc(runsRef, docData);

    // Approximate rank: count strictly faster runs + 1
    try {
      const fasterQ = query(runsRef, where('timeMs', '<', docData.timeMs));
      const fasterSnap = await getDocs(fasterQ);
      const rank = fasterSnap.size + 1;
      return { rank, timeMs: docData.timeMs };
    } catch (e) {
      console.warn('Rank lookup failed (Firestore fast path), falling back to full scan', e);
      try {
        // Full scan fallback: order all docs by timeMs and compute rank locally
        const fullQ = query(runsRef, orderBy('timeMs', 'asc'));
        const allSnap = await getDocs(fullQ);
        let faster = 0;
        allSnap.forEach(d => {
          const val = d.data() || {};
          if (typeof val.timeMs === 'number' && val.timeMs < docData.timeMs) faster += 1;
        });
        const rank = faster + 1;
        return { rank, timeMs: docData.timeMs };
      } catch (e2) {
        console.warn('Rank fallback failed (Firestore)', e2);
        return { rank: null, timeMs: docData.timeMs };
      }
    }
  };

  ready = true;
}

async function initRealtimeBackend(config) {
  const [{ initializeApp }, { getDatabase, ref, push, serverTimestamp, query, orderByChild, limitToFirst, onValue, get, endAt }]
    = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js')
    ]);

  // Ensure databaseURL exists; try to infer from projectId if missing
  const cfg = { ...config };
  if (!cfg.databaseURL && cfg.projectId) {
    cfg.databaseURL = `https://${cfg.projectId}-default-rtdb.firebaseio.com`;
  }
  const app = initializeApp(cfg);
  const db = getDatabase(app);
  console.log('[Leaderboard] Using RTDB URL:', cfg.databaseURL || '(default)');
  const runsRef = ref(db, 'runs');
  console.log('[Leaderboard] RTDB path:', '/runs');

  subscribeTop = (cb) => {
    const q = query(runsRef, orderByChild('timeMs'), limitToFirst(10));
    // Initial one-time fetch for fast first paint
    get(q).then((snap) => {
      const rows = [];
      snap.forEach(child => {
        const val = child.val() || {};
        rows.push({ id: child.key, ...val });
      });
      renderTopAndFlag(rows);
    }).catch(() => {});
    const unsub = onValue(q, (snap) => {
      const rows = [];
      snap.forEach(child => {
        const val = child.val() || {};
        rows.push({ id: child.key, ...val });
      });
      cb(rows);
    }, (err) => {
      console.warn('RTDB listen failed', err);
      renderNeedsConfig();
    });
    return unsub;
  };

  // Full list subscription for cached rank calculation
  try {
    const fullQ = query(runsRef, orderByChild('timeMs'));
    onValue(fullQ, (snap) => {
      const rows = [];
      snap.forEach(child => {
        const val = child.val() || {};
        rows.push({ id: child.key, ...val });
      });
      allRowsCache = rows;
    }, () => {});
  } catch {}

  submitRun = async (username, timeMs) => {
    const docData = { username: String(username || 'Anonymous').slice(0, 24), timeMs: Math.floor(timeMs), createdAt: serverTimestamp() };
    await push(runsRef, docData);
    // Approximate rank: count strictly faster runs + 1
    try {
      const fasterQ = query(runsRef, orderByChild('timeMs'), endAt(docData.timeMs - 1));
      const fasterSnap = await get(fasterQ);
      let faster = 0; fasterSnap.forEach(() => { faster += 1; });
      const rank = faster + 1;
      return { rank, timeMs: docData.timeMs };
    } catch (e) {
      console.warn('Rank lookup failed (RTDB fast path), falling back to full scan', e);
      try {
        const allQ = query(runsRef, orderByChild('timeMs'));
        const allSnap = await get(allQ);
        let faster = 0;
        allSnap.forEach(child => {
          const val = child.val() || {};
          if (typeof val.timeMs === 'number' && val.timeMs < docData.timeMs) faster += 1;
        });
        const rank = faster + 1;
        return { rank, timeMs: docData.timeMs };
      } catch (e2) {
        console.warn('Rank fallback failed (RTDB)', e2);
        return { rank: null, timeMs: docData.timeMs };
      }
    }
  };

  ready = true;
}

(async function init() {
  // Always paint something immediately
  renderLoading();
  let config = window.FIREBASE_CONFIG && typeof window.FIREBASE_CONFIG === 'object' ? window.FIREBASE_CONFIG : null;
  if (!config) {
    renderNeedsConfig();
    return;
  }
  // Try preferred backend: Firestore unless explicitly opting for Realtime DB
  const preferRealtime = !!window.USE_REALTIME_DB || !!config.databaseURL;
  console.log('[Leaderboard] Backend preference:', preferRealtime ? 'Realtime Database' : 'Firestore');
  try {
    if (preferRealtime) {
      await initRealtimeBackend(config);
    } else {
      await initFirestoreBackend(config);
    }
  } catch (e1) {
    console.warn('Primary leaderboard backend failed, attempting fallback', e1);
    try {
      if (preferRealtime) {
        await initFirestoreBackend(config);
      } else {
        await initRealtimeBackend(config);
      }
    } catch (e2) {
      console.warn('All leaderboard backends failed', e2);
      renderNeedsConfig();
    }
  }

  // Auto-subscribe UI renderer
  if (ready) {
    console.log('[Leaderboard] Backend initialized. Subscribing to top records...');
    subscribeTop((rows) => {
      console.log('[Leaderboard] Received rows:', Array.isArray(rows) ? rows.length : 0);
      renderTopAndFlag(rows);
    });
  }

  // Expose API
  window.Leaderboard = { get ready() { return ready; }, submitRun, subscribeTop, formatMs, getAllRows: () => allRowsCache.slice() };

  // Drawer interactions removed; leaderboard is always visible
})();

// Watchdog: if no data arrives within 4s, replace loading message
setTimeout(() => {
  if (!firstDataRendered) {
    renderNeedsConfig();
  }
}, 4000);


