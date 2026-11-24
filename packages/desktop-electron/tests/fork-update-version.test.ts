import { describe, expect, it } from 'vitest';

import {
  compareForkVersions,
  forkVersionFromTag,
  parseForkVersion,
  pickForkUpdate,
} from '../fork-update-version';
import type { GitHubRelease } from '../fork-update-version';

function release(
  tag: string,
  assets: string[] = ['Actual-mac-arm64.dmg', 'Actual-windows-x64.exe'],
  extra: Partial<GitHubRelease> = {},
): GitHubRelease {
  return {
    tag_name: tag,
    draft: false,
    assets: assets.map(name => ({
      name,
      size: 100,
      browser_download_url: `https://example.test/${tag}/${name}`,
      digest: 'sha256:ABCDEF',
    })),
    ...extra,
  };
}

describe('parseForkVersion', () => {
  it('parses a stamped fork version', () => {
    expect(parseForkVersion('26.11.0-fork.202611232130')).toEqual({
      major: 26,
      minor: 11,
      patch: 0,
      build: 202611232130,
    });
  });

  it('rejects vanilla and malformed versions', () => {
    expect(parseForkVersion('26.11.0')).toBeNull();
    expect(parseForkVersion('26.11.0-fork.')).toBeNull();
    expect(parseForkVersion('1.2')).toBeNull();
  });
});

describe('compareForkVersions', () => {
  it('orders by upstream version before build time', () => {
    const older = parseForkVersion('26.9.0-fork.202612010000')!;
    const newer = parseForkVersion('26.11.0-fork.202611010000')!;
    expect(compareForkVersions(newer, older)).toBeGreaterThan(0);
  });

  it('orders builds of the same upstream version by build time', () => {
    const a = parseForkVersion('26.11.0-fork.202611230000')!;
    const b = parseForkVersion('26.11.0-fork.202611231200')!;
    expect(compareForkVersions(a, b)).toBeLessThan(0);
  });
});

describe('forkVersionFromTag', () => {
  it('ignores the old numbered fork tags and upstream tags', () => {
    expect(forkVersionFromTag('fork-v1.2')).toBeNull();
    expect(forkVersionFromTag('v26.11.0')).toBeNull();
    expect(forkVersionFromTag('fork-v26.11.0-fork.202611232130')).toBe(
      '26.11.0-fork.202611232130',
    );
  });
});

describe('pickForkUpdate', () => {
  const current = '26.11.0-fork.202611230000';

  it('picks the newest release with an installer for this platform', () => {
    const update = pickForkUpdate(
      [
        release('fork-v26.11.0-fork.202611240000'),
        release('fork-v26.11.0-fork.202611250000'),
        release('fork-v1.2'),
      ],
      current,
      'darwin',
      'arm64',
    );
    expect(update).toMatchObject({
      version: '26.11.0-fork.202611250000',
      assetName: 'Actual-mac-arm64.dmg',
      sha256: 'abcdef',
    });
  });

  it('returns null when nothing is newer', () => {
    expect(
      pickForkUpdate(
        [release('fork-v26.11.0-fork.202611230000')],
        current,
        'darwin',
        'arm64',
      ),
    ).toBeNull();
  });

  it('skips drafts and releases missing this platform', () => {
    expect(
      pickForkUpdate(
        [
          release('fork-v26.11.0-fork.202611240000', [], {}),
          release('fork-v26.11.0-fork.202611250000', undefined, {
            draft: true,
          }),
        ],
        current,
        'win32',
        'x64',
      ),
    ).toBeNull();
  });

  it('skips an installer that is still uploading', () => {
    const uploading = release('fork-v26.11.0-fork.202611240000');
    uploading.assets = uploading.assets.map(a => ({ ...a, state: 'open' }));
    expect(pickForkUpdate([uploading], current, 'darwin', 'arm64')).toBeNull();
  });

  it('never updates a vanilla build into the fork', () => {
    expect(
      pickForkUpdate(
        [release('fork-v26.11.0-fork.202611240000')],
        '26.11.0',
        'darwin',
        'arm64',
      ),
    ).toBeNull();
  });

  it('has nothing for platforms the fork does not build', () => {
    expect(
      pickForkUpdate(
        [release('fork-v26.11.0-fork.202611240000')],
        current,
        'linux',
        'x64',
      ),
    ).toBeNull();
  });
});
