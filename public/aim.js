// Aim Trainer: 5 dots spawn randomly; click all as fast as possible
// Uses dynamic Firebase imports so the game still works offline/no-Firebase.
(function () {
	// Elements
	const area = document.getElementById('aim-area');
	const timeEl = document.getElementById('aim-time');
	const bestEl = document.getElementById('aim-best');
	const lastEl = document.getElementById('aim-last');
	const statusEl = document.getElementById('aim-status');
	const usersList = document.getElementById('aim-lb-users-list');
	const allList = document.getElementById('aim-lb-all-list');
	const usersWrap = document.getElementById('aim-users-wrap');
	const allWrap = document.getElementById('aim-all-wrap');
	const btnUsers = document.getElementById('aim-toggle-users');
	const btnAll = document.getElementById('aim-toggle-all');
	if (!area || !timeEl || !bestEl || !lastEl || !statusEl || !usersList || !allList || !usersWrap || !allWrap || !btnUsers || !btnAll) return;

	// Constants
	const DOT_COUNT = 5;
	const DOT_DIAMETER = 28;
	const COLLECTION = 'aim_runs';

	// State
	let running = false;
	let startTimeMs = 0;
	let timerId = 0;
	let remaining = DOT_COUNT;
	let db = null;
	let unsubTop = null;
	let fs = null; // firestore module fns
	let allRowsCache = [];
	let clickTimesMs = []; // cumulative from start; length == DOT_COUNT
	let currentView = 'users'; // 'users' | 'all'

	function now() {
		return performance && performance.now ? performance.now() : Date.now();
	}

	function formatSeconds(ms) {
		const total = Math.max(0, Math.floor(ms));
		const s = (total / 1000).toFixed(3);
		return `${s}s`;
	}

	function getCookie(name) {
		try {
			const m = document.cookie.match(new RegExp('(?:^|; )' + encodeURIComponent(name) + '=([^;]*)'));
			return m ? decodeURIComponent(m[1]) : null;
		} catch (_) {
			return null;
		}
	}

	function getUsername() {
		const btn = document.getElementById('user-name-btn');
		if (btn && typeof btn.textContent === 'string' && btn.textContent.trim()) {
			return btn.textContent.trim();
		}
		const c = getCookie('site:name');
		return (c && c.trim()) || 'Anonymous';
	}

	function renderAllTimes(rows) {
		allList.innerHTML = '';
		if (!Array.isArray(rows) || rows.length === 0) {
			const li = document.createElement('li');
			li.textContent = 'No runs yet — be the first!';
			allList.appendChild(li);
			return;
		}
		rows.forEach((row, idx) => {
			const li = document.createElement('li');
			li.className = 'lb-item';
			li.style.animationDelay = `${Math.min(idx * 30, 240)}ms`;
			const splits = Array.isArray(row.interMs) ? row.interMs.map(n => `${Math.floor(n)}ms`).join(' / ') : '—';
			const avg = typeof row.avgInterMs === 'number' ? `${Math.round(row.avgInterMs)}ms` : '—';
			const rowDiv = document.createElement('div');
			rowDiv.className = 'lb-row';
			rowDiv.innerHTML = [
				`<span class="lb-col-rank">${idx + 1}.</span>`,
				`<span class="lb-col-user">${(row.username || 'Anonymous')}</span>`,
				`<span class="lb-col-time">${formatSeconds(row.timeMs)}</span>`,
				`<span class="lb-col-splits">${splits}</span>`,
				`<span class="lb-col-avg">${avg}</span>`
			].join('');
			li.appendChild(rowDiv);
			allList.appendChild(li);
		});
	}

	function renderUsersBest(rows) {
		usersList.innerHTML = '';
		if (!Array.isArray(rows) || rows.length === 0) {
			const li = document.createElement('li');
			li.textContent = 'No users yet';
			usersList.appendChild(li);
			return;
		}
		// pick best per user (prefer uid match, fallback to username)
		const bestByKey = new Map();
		rows.forEach(r => {
			if (!r || typeof r.timeMs !== 'number') return;
			const key = r.uid ? `uid:${r.uid}` : `name:${r.username || 'Anonymous'}`;
			const existing = bestByKey.get(key);
			if (!existing || r.timeMs < existing.timeMs) bestByKey.set(key, r);
		});
		const bestRows = Array.from(bestByKey.values()).sort((a, b) => a.timeMs - b.timeMs).slice(0, 20);
		bestRows.forEach((r, idx) => {
			const li = document.createElement('li');
			li.className = 'lb-item';
			li.style.animationDelay = `${Math.min(idx * 30, 240)}ms`;
			const splits = Array.isArray(r.interMs) ? r.interMs.map(n => `${Math.floor(n)}ms`).join(' / ') : '—';
			const avg = typeof r.avgInterMs === 'number' ? `${Math.round(r.avgInterMs)}ms` : '—';
			const rowDiv = document.createElement('div');
			rowDiv.className = 'lb-row';
			rowDiv.innerHTML = [
				`<span class="lb-col-rank">${idx + 1}.</span>`,
				`<span class="lb-col-user">${(r.username || 'Anonymous')}</span>`,
				`<span class="lb-col-time">${formatSeconds(r.timeMs)}</span>`,
				`<span class="lb-col-splits">${splits}</span>`,
				`<span class="lb-col-avg">${avg}</span>`
			].join('');
			li.appendChild(rowDiv);
			usersList.appendChild(li);
		});
	}

	function setStatus(text) {
		statusEl.textContent = text;
	}

	function clearDots() {
		while (area.firstChild) area.removeChild(area.firstChild);
	}

	function spawnDots() {
		// Use clientWidth/Height to avoid 0 during early layout; retry if too small
		const w = area.clientWidth;
		const h = area.clientHeight;
		if (!w || !h || w < DOT_DIAMETER * 3 || h < DOT_DIAMETER * 3) {
			// Defer until layout stabilizes
			setTimeout(spawnDots, 80);
			return;
		}
		const radius = DOT_DIAMETER / 2;
		const placed = [];

		for (let i = 0; i < DOT_COUNT; i++) {
			let x = 0, y = 0, tries = 0;
			do {
				x = Math.random() * Math.max(1, (w - DOT_DIAMETER)) + radius;
				y = Math.random() * Math.max(1, (h - DOT_DIAMETER)) + radius;
				tries++;
				// Avoid overlapping too much
			} while (
				placed.some(p => {
					const dx = p.x - x;
					const dy = p.y - y;
					return Math.hypot(dx, dy) < DOT_DIAMETER * 1.2;
				}) && tries < 50
			);
			placed.push({ x, y });
		}

		placed.forEach(({ x, y }) => {
			const dot = document.createElement('div');
			dot.className = 'aim-dot';
			dot.style.left = `${x}px`;
			dot.style.top = `${y}px`;
			dot.addEventListener('click', onDotClick, { once: true });
			area.appendChild(dot);
		});
	}

	function onDotClick(e) {
		const el = e.currentTarget;
		if (el && el.parentNode === area) {
			// If this is the first click of the round, start timer at this instant
			let ts = now();
			if (!running) {
				startRun(ts);
			}
			area.removeChild(el);
			remaining -= 1;
			// record cumulative time since start for this click
			try { clickTimesMs.push(ts - startTimeMs); } catch (_) {}
			if (remaining <= 0) finishRun();
		}
	}

	function startRun(atTs) {
		if (running) return;
		running = true;
		// Do not clear or respawn dots; we want the first click to count
		startTimeMs = typeof atTs === 'number' ? atTs : now();
		setStatus('Go!');
		updateTimer();
		timerId = window.setInterval(updateTimer, 50);
	}

	function prepareRound() {
		running = false;
		window.clearInterval(timerId);
		timerId = 0;
		remaining = DOT_COUNT;
		clickTimesMs = [];
		clearDots();
		spawnDots();
		setStatus('Tap to start');
	}

	function updateTimer() {
		if (!running) return;
		const elapsed = now() - startTimeMs;
		timeEl.textContent = formatSeconds(elapsed);
	}

	async function finishRun() {
		if (!running) return;
		running = false;
		window.clearInterval(timerId);
		timerId = 0;
		const elapsed = now() - startTimeMs;
		timeEl.textContent = formatSeconds(elapsed);
		lastEl.textContent = formatSeconds(elapsed);
		setStatus('Finished! Tap to play again.');

		// Save best (local UI-only)
		try {
			const prevBest = bestEl.getAttribute('data-ms') ? Number(bestEl.getAttribute('data-ms')) : null;
			if (prevBest == null || elapsed < prevBest) {
				bestEl.textContent = formatSeconds(elapsed);
				bestEl.setAttribute('data-ms', String(Math.floor(elapsed)));
			}
		} catch (_) {}

		// Submit to Firestore
		try {
			if (!db || !fs) throw new Error('DB not ready');
			const runsRef = fs.collection(db, COLLECTION);
			// compute inter-click intervals from cumulative times
			let inter = [];
			if (Array.isArray(clickTimesMs) && clickTimesMs.length > 0) {
				for (let i = 0; i < clickTimesMs.length; i++) {
					if (i === 0) inter.push(Math.floor(clickTimesMs[0]));
					else inter.push(Math.floor(clickTimesMs[i] - clickTimesMs[i - 1]));
				}
			}
			const avgInter = inter.length ? Math.round(inter.reduce((a, b) => a + b, 0) / inter.length) : null;
			const payload = {
				username: String(getUsername()).slice(0, 24),
				timeMs: Math.floor(elapsed),
				uid: getCookie('site:uid') || null,
				interMs: inter,
				avgInterMs: avgInter,
				createdAt: fs.serverTimestamp()
			};
			await fs.addDoc(runsRef, payload);
		} catch (e) {
			console.warn('[AimTrainer] Failed to submit run to Firestore. Falling back to local-only UI.', e);
		}
		// Prepare next round
		prepareRound();
	}

	function subscribeTop() {
		if (!db || !fs) return;
		const runsRef = fs.collection(db, COLLECTION);
		// Full ordered subscription for all runs (scrollable list) and users-best aggregation
		const fullQ = fs.query(runsRef, fs.orderBy('timeMs', 'asc'));
		// Initial fetch
		fs.getDocs(fullQ).then(snap => {
			const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
			allRowsCache = rows;
			renderAllTimes(rows);
			renderUsersBest(rows);
			updateBestForUser(rows);
		}).catch(() => {});
		// Live updates
		unsubTop = fs.onSnapshot(fullQ, (snap) => {
			const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
			allRowsCache = rows;
			renderAllTimes(rows);
			renderUsersBest(rows);
			updateBestForUser(rows);
		}, (err) => {
			console.warn('[AimTrainer] Leaderboard listen failed', err);
		});
	}

	function updateBestForUser(rows) {
		try {
			const name = getUsername();
			const uid = getCookie('site:uid');
			let best = null;
			rows.forEach(r => {
				if (!r) return;
				const sameUser = (uid && r.uid && r.uid === uid) || (r.username && r.username === name);
				if (sameUser && typeof r.timeMs === 'number') {
					if (best == null || r.timeMs < best) best = r.timeMs;
				}
			});
			if (best != null) {
				bestEl.textContent = formatSeconds(best);
				bestEl.setAttribute('data-ms', String(best));
			}
		} catch (_) {}
	}

	function setView(view) {
		currentView = view === 'all' ? 'all' : 'users';
		if (currentView === 'users') {
			usersWrap.style.display = '';
			allWrap.style.display = 'none';
			btnUsers.classList.add('on');
			btnAll.classList.remove('on');
		} else {
			usersWrap.style.display = 'none';
			allWrap.style.display = '';
			btnUsers.classList.remove('on');
			btnAll.classList.add('on');
		}
	}

	async function initFirebase() {
		try {
			const cfg = (window && window.FIREBASE_CONFIG) || null;
			if (!cfg) return null;
			const appMod = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js');
			fs = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
			const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
			return fs.getFirestore(app);
		} catch (e) {
			console.warn('[AimTrainer] Firebase not available.', e);
			return null;
		}
	}

	// Wire up
	btnUsers.addEventListener('click', () => setView('users'));
	btnAll.addEventListener('click', () => setView('all'));
	// Click-to-start on area; if clicking a dot, dot handler starts it
	area.addEventListener('click', (e) => {
		if (running) return;
		// Start only if the click target is the area itself (not a dot)
		if (e.target !== area) return;
		startRun(now());
	}, false);

	// Init
	(async function bootstrap(){
		// default view
		setView('users');
		db = await initFirebase();
		if (db) {
			subscribeTop();
		} else {
			// If missing Firebase config, show a friendly message
			renderAllTimes([]);
			renderUsersBest([]);
		}
		// Prepare initial dots so you can start by clicking immediately
		prepareRound();
	})();
})(); 
 
