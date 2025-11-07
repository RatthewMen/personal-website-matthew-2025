// Minimal GitHub data/utilities shared across pages
// Exposes window.GitHubUI with render helpers

const GitHubAPI = (() => {
  const CACHE_PREFIX = 'ghcache:';
  const ONE_HOUR = 60 * 60 * 1000;
  function readCache(key){
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function writeCache(key, data){
    try {
      const wrapped = { data, fetchedAt: Date.now() };
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(wrapped));
      return wrapped;
    } catch (_) { return null; }
  }
  function isStale(cache, maxAgeMs){
    if (!cache || !cache.fetchedAt) return true;
    return (Date.now() - cache.fetchedAt) > (maxAgeMs || ONE_HOUR);
  }
  async function fetchJson(url){
    try {
      const r = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } });
      const data = r.ok ? await r.json() : null;
      return { ok: r.ok, status: r.status, headers: r.headers, data };
    } catch (err) {
      return { ok: false, status: 0, headers: new Headers(), data: null };
    }
  }
  const fmtPST = (dateStr) => {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      }).format(new Date(dateStr));
    } catch (_) {
      return new Date(dateStr).toLocaleString();
    }
  };

  async function fetchUser(username){
    const key = `user:${username}`;
    const cached = readCache(key);
    if (cached && !isStale(cached, ONE_HOUR)) return cached.data;
    const { ok, status, data } = await fetchJson(`https://api.github.com/users/${username}`);
    if (ok) { writeCache(key, data); return data; }
    return cached ? cached.data : null;
  }

  async function fetchEvents(username, perPage = 100){
    const key = `events:${username}:${perPage}`;
    const cached = readCache(key);
    if (cached && !isStale(cached, ONE_HOUR)) return cached.data;
    const { ok, status, data } = await fetchJson(`https://api.github.com/users/${username}/events/public?per_page=${perPage}`);
    if (ok) { writeCache(key, data); return data; }
    return cached ? cached.data : [];
  }

  function mapEventTypeToLabel(type){
    if (!type) return '';
    return type
      .replace('Event','')
      .replace('PullRequest','Pull Request')
      .replace('Issues','Issue')
      .replace('IssueComment','Issue Comment');
  }

  function deriveLastContribution(events){
    const e = Array.isArray(events) ? events.find(ev => ev && ev.created_at) : null;
    if (!e) return null;
    const repoFull = e.repo && e.repo.name || '';
    const repo = repoFull.includes('/') ? repoFull.split('/')[1] : repoFull;
    return {
      at: e.created_at,
      atFormatted: fmtPST(e.created_at) + ' PST',
      type: mapEventTypeToLabel(e.type),
      repo
    };
  }

  async function fetchAllRepos(username){
    const key = `repos:${username}`;
    const cached = readCache(key);
    if (cached && !isStale(cached, ONE_HOUR)) return cached.data;
    const all = [];
    let page = 1;
    const per = 100;
    while (true) {
      const { ok, data: batch } = await fetchJson(`https://api.github.com/users/${username}/repos?sort=updated&per_page=${per}&page=${page}`);
      if (!ok) break;
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < per) break;
      page++;
      if (page > 10) break; // safety cap
    }
    // Ensure sorted by pushed_at/updated_at
    all.sort((a,b) => new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at));
    if (all.length > 0) writeCache(key, all);
    return all.length > 0 ? all : (cached ? cached.data : []);
  }

  function buildRepoListItem(repo, lastActivityMap, opts){
    const options = opts || {};
    const newTab = options.newTab !== undefined ? options.newTab : true;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'repo-chip';
    a.href = repo.html_url;
    if (newTab) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    const activity = lastActivityMap && lastActivityMap[repo.name];
    const updatedDate = new Date(repo.updated_at).toLocaleDateString();
    a.innerHTML = `<span class="name">${repo.name}</span><span class="meta"><span class="updated">Updated ${updatedDate}</span><span class="activity"> ${activity?`• Last: ${activity}`:''}</span></span>`;
    li.appendChild(a);
    return li;
  }

  function buildLastActivityMap(events){
    const map = {};
    (Array.isArray(events)?events:[]).forEach(ev => {
      if (!ev || !ev.repo || !ev.type) return;
      const name = ev.repo.name && ev.repo.name.split('/')[1];
      if (name && !map[name]) map[name] = mapEventTypeToLabel(ev.type);
    });
    return map;
  }

  return { fmtPST, fetchUser, fetchEvents, fetchAllRepos, deriveLastContribution, buildRepoListItem, buildLastActivityMap };
})();

window.GitHubUI = {
  async initAboutCard({ username, chartImgId, lastElId, reposListId, refreshMs = 120000 }){
    const chart = document.getElementById(chartImgId);
    const lastEl = document.getElementById(lastElId);
    const listEl = document.getElementById(reposListId);
    if (chart) chart.src = `https://ghchart.rshah.org/39d353/${username}`;
    async function populate(){
      try {
        // 1) Render cached data immediately if present
        const cachedUser = localStorage.getItem('ghcache:user:' + username);
        const cachedEvents = localStorage.getItem('ghcache:events:' + username + ':100');
        const cachedRepos = localStorage.getItem('ghcache:repos:' + username);
        if (cachedEvents || cachedRepos) {
          try {
            const evWrap = cachedEvents ? JSON.parse(cachedEvents) : null;
            const rpWrap = cachedRepos ? JSON.parse(cachedRepos) : null;
            const events = evWrap && evWrap.data || [];
            const repos = rpWrap && rpWrap.data || [];
            const last = GitHubAPI.deriveLastContribution(events);
            const map = GitHubAPI.buildLastActivityMap(events);
            if (last && lastEl) lastEl.textContent = `Last Activity: ${last.atFormatted}`;
            if (Array.isArray(repos) && repos.length && listEl) {
              listEl.innerHTML = '';
              repos.slice(0, 5).forEach(r => listEl.appendChild(GitHubAPI.buildRepoListItem(r, map, { newTab: false })));
            }
          } catch (_) {}
        }

        // 2) Refresh network (uses cache-aware API functions)
        const [user, events, repos] = await Promise.all([
          GitHubAPI.fetchUser(username),
          GitHubAPI.fetchEvents(username, 100),
          GitHubAPI.fetchAllRepos(username)
        ]);
        const last = GitHubAPI.deriveLastContribution(events);
        const map = GitHubAPI.buildLastActivityMap(events);
        if (last && lastEl) lastEl.textContent = `Last Activity: ${last.atFormatted}`;
        if (Array.isArray(repos) && listEl) {
          listEl.innerHTML = '';
          repos.slice(0, 5).forEach(r => listEl.appendChild(GitHubAPI.buildRepoListItem(r, map, { newTab: false })));
        }
        // Profile chip enhancements
        const chip = document.getElementById('open-gh-chip');
        if (chip && user) {
          const avatar = chip.querySelector('.avatar');
          const handle = chip.querySelector('.handle');
          if (avatar && user.avatar_url) avatar.src = user.avatar_url;
          if (handle && user.login) handle.textContent = `@${user.login}`;
        }
      } catch (err) {
        if (lastEl) lastEl.textContent = 'Using cached GitHub data (API limited).';
        if (listEl && !listEl.children.length) {
          listEl.innerHTML = '';
          const li = document.createElement('li');
          li.textContent = 'Projects shown may be cached.';
          listEl.appendChild(li);
        }
        console && console.warn && console.warn('GitHub populate failed', err);
      }
    }
    await populate();
    // Auto-refresh
    if (refreshMs && Number.isFinite(refreshMs) && refreshMs >= 60000) {
      if (window.__GH_ABOUT_TIMER) clearInterval(window.__GH_ABOUT_TIMER);
      window.__GH_ABOUT_TIMER = setInterval(populate, refreshMs);
    }
  },

  async initPopoverPreview({ username, chartImgId, lastElId, reposListId }){
    const chart = document.getElementById(chartImgId);
    const lastEl = document.getElementById(lastElId);
    const listEl = document.getElementById(reposListId);
    if (chart) chart.src = `https://ghchart.rshah.org/39d353/${username}`;
    const events = await GitHubAPI.fetchEvents(username, 50);
    const last = GitHubAPI.deriveLastContribution(events);
    const map = GitHubAPI.buildLastActivityMap(events);
    if (last && lastEl) lastEl.textContent = `Last contribution: ${last.type}${last.repo?` in ${last.repo}`:''} — ${last.atFormatted}`;
    // recent repos
    const repos = await GitHubAPI.fetchAllRepos(username);
    if (Array.isArray(repos) && listEl) {
      listEl.innerHTML = '';
      repos.slice(0, 3).forEach(r => listEl.appendChild(GitHubAPI.buildRepoListItem(r, map, { newTab: true })));
    }
  },

  async initGitHubPage({ username, avatarId, usernameId, chartImgId, lastElId, reposListId }){
    const avatar = document.getElementById(avatarId);
    const uname = document.getElementById(usernameId);
    const chart = document.getElementById(chartImgId);
    const lastEl = document.getElementById(lastElId);
    const listEl = document.getElementById(reposListId);
    if (chart) chart.src = `https://ghchart.rshah.org/39d353/${username}`;
    const [user, events, repos] = await Promise.all([
      GitHubAPI.fetchUser(username),
      GitHubAPI.fetchEvents(username, 100),
      GitHubAPI.fetchAllRepos(username)
    ]);
    if (user) { if (avatar) avatar.src = user.avatar_url; if (uname) uname.textContent = `@${user.login}`; }
    const last = GitHubAPI.deriveLastContribution(events);
    const map = GitHubAPI.buildLastActivityMap(events);
    if (last && lastEl) lastEl.textContent = `Last contribution: ${last.type}${last.repo?` in ${last.repo}`:''} — ${last.atFormatted}`;
    if (Array.isArray(repos) && listEl) {
      listEl.innerHTML = '';
      repos.forEach(r => listEl.appendChild(GitHubAPI.buildRepoListItem(r, map, { newTab: true })));
    }
  }
};


