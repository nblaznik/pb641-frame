const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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

async function revisionFor(image) {
  const digest = await crypto.subtle.digest('SHA-256', image);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function handleApi(request, env, url) {
  if (!tokenMatches(suppliedToken(request, url), env.FRAME_TOKEN)) {
    return response('Unauthorized\n', 401, { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  if (request.method === 'GET' && url.pathname === '/api/revision') {
    const revision = await env.FRAME_DATA.get('revision');
    return revision
      ? response(`${revision}\n`, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
      : response(null, 204);
  }

  if (request.method === 'GET' && url.pathname === '/api/image') {
    const [image, revision] = await Promise.all([
      env.FRAME_DATA.get('image', 'arrayBuffer'),
      env.FRAME_DATA.get('revision'),
    ]);
    if (!image) return response('No drawing has been sent\n', 404);
    return response(image, 200, {
      'Content-Type': 'image/jpeg',
      ETag: `"${revision}"`,
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/image') {
    if (!(request.headers.get('Content-Type') || '').startsWith('image/jpeg')) {
      return response('Expected image/jpeg\n', 415);
    }
    const declaredSize = Number(request.headers.get('Content-Length') || 0);
    if (declaredSize > MAX_IMAGE_BYTES) return response('Image is too large\n', 413);

    const image = await request.arrayBuffer();
    const bytes = new Uint8Array(image);
    if (bytes.length < 4 || bytes.length > MAX_IMAGE_BYTES ||
        bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
        bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      return response('Invalid JPEG\n', 400);
    }

    const revision = await revisionFor(image);
    const previousRevision = await env.FRAME_DATA.get('revision');
    const changed = revision !== previousRevision;
    if (changed) {
      await env.FRAME_DATA.put('image', image);
      await env.FRAME_DATA.put('revision', revision);
    }
    return response(JSON.stringify({ revision, changed }), changed ? 201 : 200, {
      'Content-Type': 'application/json; charset=utf-8',
    });
  }

  return response('Not found\n', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};
