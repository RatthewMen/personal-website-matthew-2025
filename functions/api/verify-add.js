export async function onRequestPost(context) {
	// Cloudflare Pages Function: verifies add password
	const { request, env } = context;
	const expected = String(env.ADD_POKEMON_PASSWORD || '').trim();
	if (!expected) {
		return new Response(
			JSON.stringify({ ok: false, error: 'Server not configured' }),
			{ status: 500, headers: { 'content-type': 'application/json' } }
		);
	}
	let supplied = '';
	try {
		const body = await request.json();
		if (body && typeof body.password === 'string') {
			supplied = body.password.trim();
		}
	} catch {
		// ignore malformed json; treat as empty password
	}
	if (!supplied || supplied !== expected) {
		return new Response(
			JSON.stringify({ ok: false }),
			{ status: 403, headers: { 'content-type': 'application/json' } }
		);
	}
	return new Response(
		JSON.stringify({ ok: true }),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}


