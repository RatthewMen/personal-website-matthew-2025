import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getFirestore, collection, onSnapshot, getDocs } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

function coerceDisplay(value) {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') return String(value);
	// Firestore Timestamp
	if (value && typeof value.toDate === 'function') {
		try { return value.toDate().toLocaleString(); } catch (_) {}
	}
	if (Array.isArray(value)) return value.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

function renderUsers(docs) {
	const grid = document.getElementById('vu-grid');
	if (!grid) return;
	const arr = Array.isArray(docs) ? docs : [];
	grid.innerHTML = '';
	if (arr.length === 0) {
		const card = document.createElement('div');
		card.className = 'about-card';
		card.innerHTML = '<h2>No users yet</h2><p class="mono" style="color:#9fb5d4">Visit the site to create your entry.</p>';
		grid.appendChild(card);
		return;
	}
	arr.forEach(u => {
		const card = document.createElement('div');
		card.className = 'about-card';
		const title = document.createElement('h2');
		const name = (typeof u.name === 'string' && u.name.trim()) ? u.name.trim() : u.id;
		title.textContent = name || 'Anonymous';
		card.appendChild(title);
		const ul = document.createElement('ul');
		ul.style.listStyle = 'none';
		ul.style.paddingLeft = '0';
		ul.style.display = 'grid';
		ul.style.gap = '6px';
		const orderedKeys = ['lastVisitAt', 'os', 'darkMode'];
		orderedKeys.forEach(k => {
			if (!(k in u)) return;
			const li = document.createElement('li');
			li.className = 'mono';
			li.style.color = '#c7d7ea';
			li.textContent = `${k}: ${coerceDisplay(u[k])}`;
			ul.appendChild(li);
		});
		card.appendChild(ul);
		grid.appendChild(card);
	});
}

(async function initVisitedUsers(){
	const grid = document.getElementById('vu-grid');
	if (!grid) return;
	const cfg = (window && window.FIREBASE_CONFIG) || null;
	if (!cfg) return;
	const app = getApps().length ? getApp() : initializeApp(cfg);
	const db = getFirestore(app);
	const col = collection(db, 'users');

	// Try live subscription; fall back to one-time fetch
	let bound = false;
	try {
		onSnapshot(col, snap => {
			const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
			renderUsers(rows);
		}, () => {});
		bound = true;
	} catch (_) {}
	if (!bound) {
		try {
			const snap = await getDocs(col);
			renderUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
		} catch (_) {
			renderUsers([]);
		}
	}
})();


