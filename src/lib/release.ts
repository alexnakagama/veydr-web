// Fetches the latest Veydr release from GitHub at build time.
//
// The site is rebuilt whenever a release is published, edited, unpublished or deleted (veydr's
// .github/workflows/website.yml calls a Vercel Deploy Hook), so download links and checksums always
// match the real release.
//
// Failure policy:
// - Production builds on Vercel (VERCEL_ENV=production) or RELEASE_STRICT=1: any problem fails the
//   build. Vercel then keeps serving the previous good deployment, so the live site never shows
//   stale or broken download data.
// - Everywhere else (local dev, preview deployments): fall back to the last known release, with a
//   warning, so working on the page never depends on the GitHub API.

const REPO = 'alexnakagama/veydr';
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;

const USER_AGENT = 'veydr-web-build';
const TIMEOUT_MS = 15_000;
const ATTEMPTS = 3;

export interface Asset {
  name: string;
  url: string;
  size: number;
  sha256?: string;
}

export interface Release {
  tag: string;
  version: string;
  url: string;
  publishedAt: string;
  prerelease: boolean;
  deb?: Asset;
  appImage?: Asset;
  sums?: Asset;
  live: boolean;
}

const FALLBACK: Release = {
  tag: 'v0.1.0-rc.1',
  version: '0.1.0-rc.1',
  url: `${RELEASES_URL}/tag/v0.1.0-rc.1`,
  publishedAt: '2026-10-26T00:00:00Z',
  prerelease: true,
  deb: {
    name: 'Veydr-0.1.0-rc.1-amd64.deb',
    url: `${RELEASES_URL}/download/v0.1.0-rc.1/Veydr-0.1.0-rc.1-amd64.deb`,
    size: 0,
  },
  appImage: {
    name: 'Veydr-0.1.0-rc.1-x86_64.AppImage',
    url: `${RELEASES_URL}/download/v0.1.0-rc.1/Veydr-0.1.0-rc.1-x86_64.AppImage`,
    size: 0,
  },
  sums: {
    name: 'SHA256SUMS',
    url: `${RELEASES_URL}/download/v0.1.0-rc.1/SHA256SUMS`,
    size: 0,
  },
  live: false,
};

interface GhAsset {
  name: string;
  browser_download_url: string;
  size: number;
  state: string;
}

interface GhRelease {
  tag_name: string;
  html_url: string;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  assets: GhAsset[];
}

const strict = (): boolean =>
  process.env.VERCEL_ENV === 'production' || process.env.RELEASE_STRICT === '1';

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
  };
  // Recommended on Vercel: build machines share IPs, and the anonymous limit is 60 requests/hour.
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** GET with a timeout, retrying network errors, 5xx and rate limits with a short backoff. */
async function get(url: string, headers: Record<string, string>): Promise<Response> {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return res;
      const retryable = res.status >= 500 || res.status === 429 || res.status === 403;
      last = new Error(`${res.status} ${res.statusText} for ${url}`);
      if (!retryable) break;
    } catch (err) {
      last = err;
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

const uploaded = (gh: GhRelease, match: (name: string) => boolean): GhAsset | undefined =>
  gh.assets.find((a) => a.state === 'uploaded' && match(a.name));

/** A release the site can offer: published, with both packages and SHA256SUMS fully uploaded. */
function complete(gh: GhRelease): boolean {
  return (
    !gh.draft &&
    gh.published_at !== null &&
    !!uploaded(gh, (n) => n.endsWith('-amd64.deb')) &&
    !!uploaded(gh, (n) => n.endsWith('-x86_64.AppImage')) &&
    !!uploaded(gh, (n) => n === 'SHA256SUMS')
  );
}

const toAsset = (a: GhAsset): Asset => ({ name: a.name, url: a.browser_download_url, size: a.size });

/** Reads SHA256SUMS and sets `sha256` on each target; fails unless every target has a hash. */
async function readChecksums(sums: Asset, targets: Asset[]): Promise<void> {
  const res = await get(sums.url, { 'User-Agent': USER_AGENT });
  for (const line of (await res.text()).split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    const target = m && targets.find((t) => t.name === m[2]);
    if (target && m) target.sha256 = m[1];
  }
  const missing = targets.filter((t) => !t.sha256).map((t) => t.name);
  if (missing.length) throw new Error(`SHA256SUMS has no hash for ${missing.join(', ')}`);
}

async function load(): Promise<Release> {
  const res = await get(`https://api.github.com/repos/${REPO}/releases?per_page=30`, apiHeaders());
  const list = (await res.json()) as GhRelease[];
  // Newest stable release; until one exists, the newest release candidate.
  const usable = list.filter(complete);
  const gh = usable.find((r) => !r.prerelease) ?? usable[0];
  if (!gh) throw new Error('no published release with both packages and SHA256SUMS');

  const deb = toAsset(uploaded(gh, (n) => n.endsWith('-amd64.deb'))!);
  const appImage = toAsset(uploaded(gh, (n) => n.endsWith('-x86_64.AppImage'))!);
  const sums = toAsset(uploaded(gh, (n) => n === 'SHA256SUMS')!);
  await readChecksums(sums, [deb, appImage]);

  return {
    tag: gh.tag_name,
    version: gh.tag_name.replace(/^v/, ''),
    url: gh.html_url,
    publishedAt: gh.published_at!,
    prerelease: gh.prerelease,
    deb,
    appImage,
    sums,
    live: true,
  };
}

let cached: Promise<Release> | undefined;

export function getRelease(): Promise<Release> {
  cached ??= load().then(
    (release) => {
      console.info(`[release] ${release.tag} (${release.prerelease ? 'prerelease' : 'stable'})`);
      return release;
    },
    (err: Error) => {
      if (strict()) {
        throw new Error(
          `[release] could not read the latest Veydr release: ${err.message}. ` +
            'Failing the build so the previous deployment stays live.',
        );
      }
      console.warn(`[release] using fallback ${FALLBACK.tag}: ${err.message}`);
      return FALLBACK;
    },
  );
  return cached;
}

export function formatSize(bytes: number): string {
  if (!bytes) return '';
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
