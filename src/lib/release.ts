// Fetches the latest Veydr release from GitHub at build time.
// The site is rebuilt when a release is published (Vercel Deploy Hook),
// so download links and checksums always match the real release.
// If GitHub can't be reached, the build falls back to the last known release
// instead of failing or rendering broken links.

const REPO = 'alexnakagama/veydr';
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;

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
  publishedAt: '2026-10-25T00:00:00Z',
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
}

interface GhRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
  assets: GhAsset[];
}

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'veydr-web-build',
  };
  // Optional: avoids the 60 req/h anonymous limit on busy build machines.
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function toAsset(a: GhAsset | undefined): Asset | undefined {
  return a && { name: a.name, url: a.browser_download_url, size: a.size };
}

async function readChecksums(sums: Asset, targets: (Asset | undefined)[]) {
  const res = await fetch(sums.url, { headers: { 'User-Agent': 'veydr-web-build' } });
  if (!res.ok) return;
  const text = await res.text();
  for (const line of text.split('\n')) {
    const [hash, file] = line.trim().split(/\s+\*?/);
    const target = targets.find((t) => t?.name === file);
    if (target && /^[0-9a-f]{64}$/.test(hash ?? '')) target.sha256 = hash;
  }
}

let cached: Promise<Release> | undefined;

export function getRelease(): Promise<Release> {
  cached ??= load();
  return cached;
}

async function load(): Promise<Release> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const list = (await res.json()) as GhRelease[];
    // Prefer the newest stable release; until one exists, use the newest candidate.
    const published = list.filter((r) => !r.draft);
    const gh = published.find((r) => !r.prerelease) ?? published[0];
    if (!gh) throw new Error('no published releases');

    const release: Release = {
      tag: gh.tag_name,
      version: gh.tag_name.replace(/^v/, ''),
      url: gh.html_url,
      publishedAt: gh.published_at,
      prerelease: gh.prerelease,
      deb: toAsset(gh.assets.find((a) => a.name.endsWith('.deb'))),
      appImage: toAsset(gh.assets.find((a) => a.name.endsWith('.AppImage'))),
      sums: toAsset(gh.assets.find((a) => a.name === 'SHA256SUMS')),
      live: true,
    };
    if (release.sums) {
      await readChecksums(release.sums, [release.deb, release.appImage]).catch(() => {});
    }
    return release;
  } catch (err) {
    console.warn(`[release] using fallback ${FALLBACK.tag}: ${(err as Error).message}`);
    return FALLBACK;
  }
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
