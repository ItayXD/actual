// Pure helpers for the fork's self-updater (see fork-updater.ts). Kept free of
// Electron imports so they can be unit tested in plain Node.
//
// Version scheme: every fork build is stamped `<upstream>-fork.<UTC
// YYYYMMDDHHMM>` (bin/fork-build-mac, .github/workflows/fork-desktop.yml), and
// a fork release is tagged `fork-v<that exact version>`. So the tag alone says
// which build a release holds, and two fork builds order by upstream version
// first, then by build time.

export const FORK_REPO = 'ItayXD/actual';
export const FORK_TAG_PREFIX = 'fork-v';

export type ForkVersion = {
  major: number;
  minor: number;
  patch: number;
  build: number;
};

const FORK_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-fork\.(\d+)$/;

export function parseForkVersion(version: string): ForkVersion | null {
  const match = FORK_VERSION_RE.exec(version.trim().replace(/^v/, ''));
  if (!match) {
    return null;
  }
  const [major, minor, patch, build] = match.slice(1).map(Number);
  return { major, minor, patch, build };
}

export function compareForkVersions(a: ForkVersion, b: ForkVersion): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    a.build - b.build
  );
}

export function forkVersionFromTag(tag: string): string | null {
  if (!tag.startsWith(FORK_TAG_PREFIX)) {
    return null;
  }
  const version = tag.slice(FORK_TAG_PREFIX.length);
  return parseForkVersion(version) ? version : null;
}

// The installer asset names electron-builder produces, per
// `artifactName` in packages/desktop-electron/package.json.
export function installerAssetName(
  platform: NodeJS.Platform,
  arch: string,
): string | null {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return `Actual-mac-${arch}.dmg`;
  }
  if (platform === 'win32' && arch === 'x64') {
    return `Actual-windows-${arch}.exe`;
  }
  return null;
}

// The subset of GitHub's release JSON this updater reads.
export type GitHubRelease = {
  tag_name: string;
  draft: boolean;
  assets: Array<{
    name: string;
    size: number;
    browser_download_url: string;
    // `sha256:<hex>`; GitHub computes it for every uploaded asset.
    digest?: string | null;
    // `uploaded` once complete; an asset mid-upload is listed as `open`.
    state?: string;
  }>;
};

export type ForkUpdate = {
  version: string;
  tag: string;
  assetName: string;
  url: string;
  size: number;
  sha256: string | null;
};

/**
 * The newest fork release that is newer than `currentVersion` and carries an
 * installer for this platform, or null when there is nothing to install.
 *
 * Returns null when the running build is not a fork build at all (a vanilla
 * version string), so an upstream build can never be "updated" into the fork.
 */
export function pickForkUpdate(
  releases: GitHubRelease[],
  currentVersion: string,
  platform: NodeJS.Platform,
  arch: string,
): ForkUpdate | null {
  const current = parseForkVersion(currentVersion);
  const assetName = installerAssetName(platform, arch);
  if (!current || !assetName) {
    return null;
  }

  let best: { parsed: ForkVersion; update: ForkUpdate } | null = null;
  for (const release of releases) {
    if (release.draft) {
      continue;
    }
    const version = forkVersionFromTag(release.tag_name);
    const parsed = version ? parseForkVersion(version) : null;
    if (!version || !parsed || compareForkVersions(parsed, current) <= 0) {
      continue;
    }
    const asset = release.assets.find(
      a => a.name === assetName && (a.state ?? 'uploaded') === 'uploaded',
    );
    if (!asset) {
      // A release whose build for this platform failed or is still uploading.
      continue;
    }
    if (best && compareForkVersions(parsed, best.parsed) <= 0) {
      continue;
    }
    const digest = asset.digest ?? '';
    best = {
      parsed,
      update: {
        version,
        tag: release.tag_name,
        assetName,
        url: asset.browser_download_url,
        size: asset.size,
        sha256: digest.startsWith('sha256:')
          ? digest.slice('sha256:'.length).toLowerCase()
          : null,
      },
    };
  }

  return best?.update ?? null;
}
