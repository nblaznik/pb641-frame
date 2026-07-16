const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_NAME_LENGTH = 80;
const MAX_LOCATION_LENGTH = 120;
const TIME_ZONE = 'Europe/Ljubljana';

function tokenMatches(actual, expected) {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function suppliedToken(request, url) {
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.startsWith('Bearer ')) return authorization.slice(7);
  return url.searchParams.get('token') || '';
}

function response(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function json(data, status = 200) {
  return response(JSON.stringify(data), status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
}

async function revisionFor(image) {
  const digest = await crypto.subtle.digest('SHA-256', image);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function contestSlot(date) {
  const values = {};
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  for (const part of parts) values[part.type] = part.value;
  const hour = Number(values.hour);
  if (hour !== 9 && hour !== 18) return null;
  return `${values.year}-${values.month}-${values.day}-${values.hour}`;
}

async function publishRound(env, slot) {
  const previous = await env.DB.prepare('SELECT slot FROM publications WHERE slot = ?').bind(slot).first();
  if (previous) return { published: false, reason: 'slot-already-published' };

  const winner = await env.DB.prepare(`
    SELECT s.id, s.artist, s.location, s.revision, COUNT(v.submission_id) AS votes
    FROM submissions s
    LEFT JOIN votes v ON v.submission_id = s.id
    WHERE s.closed_at IS NULL
    GROUP BY s.id
    ORDER BY votes DESC, s.created_at ASC
    LIMIT 1
  `).first();
  const publishedAt = new Date().toISOString();

  if (!winner) {
    await env.DB.prepare(
      'INSERT INTO publications (slot, submission_id, published_at) VALUES (?, NULL, ?)',
    ).bind(slot, publishedAt).run();
    return { published: false, reason: 'no-submissions' };
  }

  const image = await env.FRAME_DATA.get(`submission:${winner.id}`, 'arrayBuffer');
  if (!image) return { published: false, reason: 'image-missing' };

  await env.FRAME_DATA.put(`published:${winner.revision}`, image);
  await env.FRAME_DATA.put('revision', winner.revision);
  await env.FRAME_DATA.put('attribution', JSON.stringify({
    artist: winner.artist,
    location: winner.location,
    submissionId: winner.id,
    publishedAt,
  }));

  await env.DB.batch([
    env.DB.prepare('UPDATE submissions SET closed_at = ?, winner = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE closed_at IS NULL')
      .bind(publishedAt, winner.id),
    env.DB.prepare('INSERT INTO publications (slot, submission_id, published_at) VALUES (?, ?, ?)')
      .bind(slot, winner.id, publishedAt),
  ]);
  return { published: true, winner: winner.id, votes: winner.votes };
}

async function handleFrameApi(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/api/revision') {
    const revision = await env.FRAME_DATA.get('revision');
    return revision
      ? response(`${revision}\n`, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
      : response(null, 204);
  }

  if (request.method === 'GET' && url.pathname === '/api/image') {
    const requestedRevision = url.searchParams.get('revision');
    const revision = requestedRevision && /^[a-f0-9]{64}$/.test(requestedRevision)
      ? requestedRevision
      : await env.FRAME_DATA.get('revision');
    const image = revision
      ? await env.FRAME_DATA.get(`published:${revision}`, 'arrayBuffer')
      : null;
    if (!image) return response('No drawing has been published\n', 404);
    return response(image, 200, {
      'Content-Type': 'image/jpeg',
      ETag: `"${revision}"`,
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/current') {
    const attribution = await env.FRAME_DATA.get('attribution', 'json');
    return json(attribution || {});
  }

  if (request.method === 'GET' && url.pathname === '/api/submissions') {
    const result = await env.DB.prepare(`
      SELECT s.id, s.artist, s.location, s.created_at AS createdAt,
             COUNT(v.submission_id) AS votes
      FROM submissions s
      LEFT JOIN votes v ON v.submission_id = s.id
      WHERE s.closed_at IS NULL
      GROUP BY s.id
      ORDER BY votes DESC, s.created_at ASC
      LIMIT 100
    `).all();
    return json({ submissions: result.results });
  }

  if (request.method === 'POST' && url.pathname === '/api/submissions') {
    const form = await request.formData();
    const imageFile = form.get('image');
    const artist = String(form.get('artist') || '').trim();
    const location = String(form.get('location') || '').trim();
    if (!artist || artist.length > MAX_NAME_LENGTH || location.length > MAX_LOCATION_LENGTH) {
      return json({ error: 'Enter a valid name and a location of at most 120 characters.' }, 400);
    }
    if (!(imageFile instanceof File) || imageFile.type !== 'image/jpeg' || imageFile.size > MAX_IMAGE_BYTES) {
      return json({ error: 'A JPEG image of at most 8 MB is required.' }, 400);
    }
    const image = await imageFile.arrayBuffer();
    const bytes = new Uint8Array(image);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
        bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      return json({ error: 'The uploaded file is not a valid JPEG.' }, 400);
    }

    const id = crypto.randomUUID();
    const revision = await revisionFor(image);
    const createdAt = new Date().toISOString();
    await env.FRAME_DATA.put(`submission:${id}`, image, { expirationTtl: 60 * 60 * 24 * 14 });
    await env.DB.prepare(
      'INSERT INTO submissions (id, artist, location, revision, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(id, artist, location, revision, createdAt).run();
    return json({ id, artist, location, createdAt, votes: 0 }, 201);
  }

  const imageMatch = url.pathname.match(/^\/api\/submissions\/([0-9a-f-]+)\/image$/);
  if (request.method === 'GET' && imageMatch) {
    const image = await env.FRAME_DATA.get(`submission:${imageMatch[1]}`, 'arrayBuffer');
    return image
      ? response(image, 200, { 'Content-Type': 'image/jpeg' })
      : response('Not found\n', 404);
  }

  const voteMatch = url.pathname.match(/^\/api\/submissions\/([0-9a-f-]+)\/vote$/);
  if (request.method === 'POST' && voteMatch) {
    const body = await request.json();
    const voterId = String(body.voterId || '');
    if (!/^[0-9a-f-]{36}$/.test(voterId)) return json({ error: 'Invalid voter ID.' }, 400);
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO votes (submission_id, voter_id, created_at)
      SELECT id, ?, ? FROM submissions WHERE id = ? AND closed_at IS NULL
    `).bind(voterId, new Date().toISOString(), voteMatch[1]).run();
    const count = await env.DB.prepare('SELECT COUNT(*) AS votes FROM votes WHERE submission_id = ?')
      .bind(voteMatch[1]).first();
    return json({ accepted: result.meta.changes === 1, votes: count.votes });
  }

  return response('Not found\n', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/admin/publish') {
      if (!tokenMatches(suppliedToken(request, url), env.ADMIN_TOKEN)) {
        return response('Unauthorized\n', 401);
      }
      return json(await publishRound(env, `manual-${Date.now()}`));
    }
    if (url.pathname.startsWith('/api/')) return handleFrameApi(request, env, url);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env) {
    const slot = contestSlot(new Date(controller.scheduledTime));
    if (slot) await publishRound(env, slot);
  },
};
