// User/session utilities: cookies, dark mode toggle, name prompt, Firestore sync
import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getFirestore, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// ----- Cookie helpers -----
function setCookie(name, value, days = 365 * 5) {
	// Long-lived cookie, path=/, lax to persist across the site
	try {
		const expires = new Date(Date.now() + days * 864e5).toUTCString();
		document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
			String(value)
		)}; expires=${expires}; path=/; samesite=lax`;
	} catch (_) {}
}
function getCookie(name) {
	try {
		const m = document.cookie.match(
			new RegExp('(?:^|; )' + encodeURIComponent(name) + '=([^;]*)')
		);
		return m ? decodeURIComponent(m[1]) : null;
	} catch (_) {
		return null;
	}
}

function generateId() {
	if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function detectOS() {
	const ua = navigator.userAgent || '';
	const platform =
		(navigator.userAgentData && navigator.userAgentData.platform) ||
		navigator.platform ||
		'';
	if (/Win/i.test(platform)) return 'Windows';
	if (/Mac/i.test(platform)) return 'macOS';
	if (/Linux/i.test(platform)) return 'Linux';
	if (/Android/i.test(ua)) return 'Android';
	if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
	return platform || 'Unknown';
}

function applyTheme(isDark) {
	document.body.classList.toggle('light-mode', !isDark);
}

(async function initUser() {
	// Elements
	const toggle = document.getElementById('darkmode-toggle');
	const nameBtn = document.getElementById('user-name-btn');
	if (!toggle || !nameBtn) return;

	// Read existing state from cookies
	let uid = getCookie('site:uid');
	let savedName = getCookie('site:name');
	let darkCookie = getCookie('site:dark');

	const isFirstVisit = !uid;
	if (!uid) {
		uid = generateId();
		setCookie('site:uid', uid);
	}

	let isDark = darkCookie == null ? true : darkCookie === 'true';
	applyTheme(isDark);
	toggle.checked = isDark;

	if (!savedName) {
		const defaultName = 'Anonymous';
		const entered =
			(window.prompt && window.prompt('Welcome! What is your name?', defaultName)) || defaultName;
		savedName = (entered || defaultName).trim() || defaultName;
		setCookie('site:name', savedName);
	}
	nameBtn.textContent = savedName;

	// Persist OS immediately
	const os = detectOS();
	setCookie('site:os', os);

	// Firebase setup
	let app;
	try {
		const cfg = (window && window.FIREBASE_CONFIG) || null;
		if (!cfg) throw new Error('Missing FIREBASE_CONFIG');
		app = getApps().length ? getApp() : initializeApp(cfg);
	} catch (e) {
		// If Firebase isn't configured, gracefully do nothing further
		console.warn('[Users] Firebase not available.', e);
		return;
	}
	const db = getFirestore(app);

	async function saveUser(partial) {
		const ref = doc(db, 'users', uid);
		const payload = {
			name: getCookie('site:name') || nameBtn.textContent || 'Anonymous',
			darkMode: !!toggle.checked,
			os: getCookie('site:os') || os,
			lastVisitAt: serverTimestamp()
		};
		if (partial && typeof partial === 'object') Object.assign(payload, partial);
		await setDoc(ref, payload, { merge: true });
	}

	// Initial write/heartbeat
	saveUser({ firstVisit: !!isFirstVisit }).catch(() => {});

	// Handlers
	toggle.addEventListener('change', () => {
		const nextDark = !!toggle.checked;
		setCookie('site:dark', String(nextDark));
		applyTheme(nextDark);
		saveUser({ darkMode: nextDark }).catch(() => {});
	});

	nameBtn.addEventListener('click', () => {
		const current = nameBtn.textContent || 'Anonymous';
		const updated =
			(window.prompt && window.prompt('Edit your name', current)) || current;
		const trimmed = (updated || '').trim();
		if (!trimmed || trimmed === current) return;
		nameBtn.textContent = trimmed;
		setCookie('site:name', trimmed);
		saveUser({ name: trimmed }).catch(() => {});
	});
})(); 


