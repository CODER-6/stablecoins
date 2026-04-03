const UPSTREAMS = {
  stablecoins: "https://stablecoins.llama.fi",
  yields: "https://yields.llama.fi",
};

const ALLOWED_METHODS = "GET, HEAD";
const REQUEST_HEADER_ALLOWLIST = ["accept", "if-none-match", "if-modified-since"];
const RESPONSE_HEADER_ALLOWLIST = [
  "cache-control",
  "content-length",
  "content-type",
  "etag",
  "expires",
  "last-modified",
];

export async function onRequest(context) {
  const { request, params } = context;

  if (!["GET", "HEAD"].includes(request.method)) {
    return jsonResponse(
      { error: "Method Not Allowed", allowedMethods: ALLOWED_METHODS },
      405,
      { Allow: ALLOWED_METHODS },
    );
  }

  const pathSegments = normalizePathSegments(params.path);
  const [service, ...resourcePath] = pathSegments;
  const upstreamOrigin = UPSTREAMS[service];

  if (!upstreamOrigin) {
    return jsonResponse(
      {
        error: "Unknown API namespace",
        supportedNamespaces: Object.keys(UPSTREAMS),
      },
      404,
    );
  }

  const upstreamUrl = buildUpstreamUrl(upstreamOrigin, resourcePath, request.url);
  const upstreamHeaders = new Headers();

  for (const headerName of REQUEST_HEADER_ALLOWLIST) {
    const headerValue = request.headers.get(headerName);
    if (headerValue) {
      upstreamHeaders.set(headerName, headerValue);
    }
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "follow",
    });

    const responseHeaders = new Headers();
    for (const headerName of RESPONSE_HEADER_ALLOWLIST) {
      const headerValue = upstreamResponse.headers.get(headerName);
      if (headerValue) {
        responseHeaders.set(headerName, headerValue);
      }
    }
    responseHeaders.set("access-control-allow-origin", "*");
    responseHeaders.set("x-proxy-upstream", upstreamUrl.origin);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "Upstream request failed",
        message: error instanceof Error ? error.message : String(error),
      },
      502,
    );
  }
}

function normalizePathSegments(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return [value].filter(Boolean);
}

function buildUpstreamUrl(origin, resourcePath, requestUrl) {
  const upstreamUrl = new URL(resourcePath.length ? `/${resourcePath.join("/")}` : "/", origin);
  upstreamUrl.search = new URL(requestUrl).search;
  return upstreamUrl;
}

function jsonResponse(payload, status, headers = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "content-type": "application/json; charset=UTF-8",
      ...headers,
    },
  });
}
