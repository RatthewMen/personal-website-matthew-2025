export default {
  async fetch(req) {
    const url = new URL(req.url);
    const universeId = url.searchParams.get('universeId') || '7248594700';
    const placeId = url.searchParams.get('placeId') || '108476677636434';

    const getJson = async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${r.status} for ${u}`);
      return r.json();
    };

    try {
      const [games, votes, favs] = await Promise.all([
        getJson(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
        getJson(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`),
        getJson(`https://games.roblox.com/v1/games/${universeId}/favorites/count`)
          .catch(() => getJson(`https://games.roblox.com/v1/games/${placeId}/favorites/count`))
      ]);

      const row = games?.data?.[0] || {};
      const likesAccurate = votes?.data?.[0]?.upVotes ?? votes?.data?.[0]?.upvotes;
      const favRaw = typeof favs === 'number' ? favs : (favs?.favoritesCount ?? favs?.count ?? favs?.favoritedCount);

      const body = {
        likes: typeof likesAccurate === 'number' ? likesAccurate : (row.likeCount ?? row.upVotes ?? row.voteCount ?? null),
        visits: row.visits ?? null,
        playing: (row.playing ?? row.playerCount ?? null),
        favorites: typeof favRaw === 'string' ? Number(favRaw) : (favRaw ?? null),
        updatedAt: Date.now()
      };

      return new Response(JSON.stringify(body), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=60'
        }
      });
    } catch {
      return new Response(JSON.stringify({ error: 'fetch_failed' }), {
        status: 502,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
      });
    }
  }
};
