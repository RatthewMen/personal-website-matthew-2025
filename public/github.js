// Minimal GitHub data/utilities shared across pages
// Exposes window.GitHubUI with render helpers

const GitHubAPI = (() => {
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
    const r = await fetch(`https://api.github.com/users/${username}`);
    if (!r.ok) return null;
    return r.json();
  }

  async function fetchEvents(username, perPage = 100){
    const r = await fetch(`https://api.github.com/users/${username}/events/public?per_page=${perPage}`);
    if (!r.ok) return [];
    return r.json();
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
    const all = [];
    let page = 1;
    const per = 100;
    while (true) {
      const r = await fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=${per}&page=${page}`);
      if (!r.ok) break;
      const batch = await r.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < per) break;
      page++;
      if (page > 10) break; // safety cap
    }
    // Ensure sorted by pushed_at/updated_at
    all.sort((a,b) => new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at));
    return all;
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


