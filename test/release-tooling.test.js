import { describe, test, expect, jest } from '@jest/globals';
import { checkVersionSync, versionFromTag } from '../.github/scripts/check-version-sync.cjs';
import { nextVersion, replaceVersion, updateChangelog, unreleasedIsEmpty, compareVersions } from '../scripts/bump-version.mjs';
import { parseArgs, liveVersion, preflight } from '../scripts/publish-store.mjs';
import { sectionFor } from '../.github/scripts/changelog-section.cjs';

// The release path is the one place in this repo with no fast feedback loop:
// a mistake surfaces as a rejected upload or, worse, a wrong version shipped
// to users. These cover the pure decision-making, which is where the errors
// that matter live.

describe('checkVersionSync', () => {
  test('passes when both files agree', () => {
    expect(checkVersionSync({ packageVersion: '1.2.0', manifestVersion: '1.2.0' })).toEqual([]);
  });

  test('catches drift between package.json and manifest.json', () => {
    const errors = checkVersionSync({ packageVersion: '1.2.0', manifestVersion: '1.1.0' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Version mismatch/);
  });

  test('passes when the tag matches', () => {
    expect(
      checkVersionSync({ packageVersion: '1.2.0', manifestVersion: '1.2.0', tag: 'v1.2.0' })
    ).toEqual([]);
  });

  test('catches a tag that does not match the version being released', () => {
    const errors = checkVersionSync({ packageVersion: '1.2.0', manifestVersion: '1.2.0', tag: 'v1.3.0' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Tag mismatch/);
  });

  test('accepts a tag without the v prefix', () => {
    expect(
      checkVersionSync({ packageVersion: '1.2.0', manifestVersion: '1.2.0', tag: '1.2.0' })
    ).toEqual([]);
  });

  test('rejects a semver pre-release, which the store will not accept', () => {
    const errors = checkVersionSync({ packageVersion: '1.2.0-beta.1', manifestVersion: '1.2.0-beta.1' });
    expect(errors.some((e) => /not a valid Chrome extension version/.test(e))).toBe(true);
  });

  test('rejects a part above 65535', () => {
    const errors = checkVersionSync({ packageVersion: '1.70000.0', manifestVersion: '1.70000.0' });
    expect(errors.some((e) => /not a valid Chrome extension version/.test(e))).toBe(true);
  });

  test('rejects a leading zero', () => {
    const errors = checkVersionSync({ packageVersion: '1.02.0', manifestVersion: '1.02.0' });
    expect(errors.some((e) => /not a valid Chrome extension version/.test(e))).toBe(true);
  });

  test('reports a missing version rather than throwing', () => {
    const errors = checkVersionSync({ manifestVersion: '1.2.0' });
    expect(errors.some((e) => /package\.json has no "version"/.test(e))).toBe(true);
  });

  test('accepts a four-part version', () => {
    expect(checkVersionSync({ packageVersion: '1.2.0.4', manifestVersion: '1.2.0.4' })).toEqual([]);
  });
});

describe('versionFromTag', () => {
  test('strips a leading v', () => {
    expect(versionFromTag('v1.2.0')).toBe('1.2.0');
  });

  test('leaves an unprefixed tag alone', () => {
    expect(versionFromTag('1.2.0')).toBe('1.2.0');
  });
});

describe('nextVersion', () => {
  test.each([
    ['1.1.0', 'patch', '1.1.1'],
    ['1.1.0', 'minor', '1.2.0'],
    ['1.1.0', 'major', '2.0.0'],
    ['1.9.9', 'minor', '1.10.0'],
    ['1.1.0', '3.0.1', '3.0.1']
  ])('%s + %s = %s', (current, bump, expected) => {
    expect(nextVersion(current, bump)).toBe(expected);
  });

  test('returns null for something that is neither a bump type nor a version', () => {
    expect(nextVersion('1.1.0', 'sideways')).toBeNull();
  });
});

describe('compareVersions', () => {
  test('treats missing trailing parts as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  test('compares numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
  });

  test('orders a lower version below', () => {
    expect(compareVersions('1.1.0', '1.2.0')).toBe(-1);
  });
});

describe('replaceVersion', () => {
  test('replaces only the version value and leaves formatting alone', () => {
    const source = '{\n  "name": "x",\n  "version": "1.1.0",\n\n  "other": "1.1.0"\n}';
    const out = replaceVersion(source, '1.1.0', '1.2.0');
    expect(out).toContain('"version": "1.2.0"');
    // The identical string elsewhere in the file must survive untouched.
    expect(out).toContain('"other": "1.1.0"');
    // And the blank line that groups the keys.
    expect(out).toContain('",\n\n  "other"');
  });

  test('returns null when the expected version is not there', () => {
    expect(replaceVersion('{"version": "9.9.9"}', '1.1.0', '1.2.0')).toBeNull();
  });
});

describe('updateChangelog', () => {
  const changelog = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- a thing\n\n## [1.1.0]\n';

  test('opens a dated section below Unreleased', () => {
    const out = updateChangelog(changelog, '1.2.0', '2026-09-01');
    expect(out).toContain('## [Unreleased]\n\n## [1.2.0] - 2026-09-01');
  });

  test('leaves the Unreleased heading in place for the next cycle', () => {
    expect(updateChangelog(changelog, '1.2.0', '2026-09-01')).toContain('## [Unreleased]');
  });

  test('returns null when there is no Unreleased heading', () => {
    expect(updateChangelog('# Changelog\n\n## [1.1.0]\n', '1.2.0', '2026-09-01')).toBeNull();
  });
});

describe('unreleasedIsEmpty', () => {
  test('is true when nothing has landed since the last release', () => {
    expect(unreleasedIsEmpty('## [Unreleased]\n\n## [1.1.0]\n- old\n')).toBe(true);
  });

  test('is false once an entry is added', () => {
    expect(unreleasedIsEmpty('## [Unreleased]\n\n- a thing\n\n## [1.1.0]\n')).toBe(false);
  });
});

describe('parseArgs', () => {
  test('stages the publish by default', () => {
    expect(parseArgs([]).publishType).toBe('STAGED_PUBLISH');
  });

  test('blocks on warnings by default', () => {
    expect(parseArgs([]).blockOnWarnings).toBe(true);
  });

  test('--publish-immediately opts into publishing on approval', () => {
    expect(parseArgs(['--publish-immediately']).publishType).toBe('DEFAULT_PUBLISH');
  });

  test('--no-block-on-warnings opts out of the warning gate', () => {
    expect(parseArgs(['--no-block-on-warnings']).blockOnWarnings).toBe(false);
  });

  test('reads a zip path', () => {
    expect(parseArgs(['--zip=build/x.zip']).zip).toBe('build/x.zip');
  });

  test('reads a key path', () => {
    expect(parseArgs(['--key=/tmp/key.json']).key).toBe('/tmp/key.json');
  });

  test('has no key path by default, so the env var is used', () => {
    expect(parseArgs([]).key).toBeNull();
  });

  test('rejects an unknown flag rather than ignoring it', () => {
    // parseArgs exits the process on a bad flag; a typo'd --dryrun must not
    // silently become a real publish.
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => parseArgs(['--dryrun'])).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(2);
    exit.mockRestore();
    err.mockRestore();
  });
});

describe('liveVersion', () => {
  test('is null when nothing has been published yet', () => {
    expect(liveVersion({})).toBeNull();
  });

  test('reads the published version', () => {
    const status = { publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.1.0' }] } };
    expect(liveVersion(status)).toBe('1.1.0');
  });

  test('takes the highest version during a percentage rollout', () => {
    const status = {
      publishedItemRevisionStatus: {
        distributionChannels: [{ crxVersion: '1.1.0' }, { crxVersion: '1.2.0' }]
      }
    };
    expect(liveVersion(status)).toBe('1.2.0');
  });
});

describe('preflight', () => {
  const published = (v) => ({ publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: v }] } });

  test('passes for a higher version with nothing pending', () => {
    expect(preflight(published('1.1.0'), '1.2.0').problems).toEqual([]);
  });

  test('passes for a brand new item with nothing published', () => {
    expect(preflight({}, '1.0.0').problems).toEqual([]);
  });

  test('catches re-uploading the live version', () => {
    const { problems } = preflight(published('1.2.0'), '1.2.0');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/already live/);
  });

  test('catches a version lower than what is live', () => {
    const { problems } = preflight(published('1.2.0'), '1.1.0');
    expect(problems[0]).toMatch(/is lower than the live version/);
  });

  test('refuses while a submission is under review', () => {
    const status = { ...published('1.1.0'), submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } };
    expect(preflight(status, '1.2.0').problems[0]).toMatch(/already under review/);
  });

  test('refuses while an approved build is staged and unreleased', () => {
    const status = { ...published('1.1.0'), submittedItemRevisionStatus: { state: 'STAGED' } };
    expect(preflight(status, '1.2.0').problems[0]).toMatch(/already staged/);
  });

  test('refuses when the item has been taken down', () => {
    const status = { ...published('1.1.0'), takenDown: true };
    expect(preflight(status, '1.2.0').problems[0]).toMatch(/taken down/);
  });

  test('reports the live version alongside the problems', () => {
    expect(preflight(published('1.1.0'), '1.2.0').live).toBe('1.1.0');
  });
});

describe('sectionFor', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [1.2.0] - 2026-09-01',
    '',
    '### Added',
    '',
    '- the new thing',
    '',
    '## [1.1.0] - 2026-08-01',
    '',
    '- the old thing',
    ''
  ].join('\n');

  test('returns just that version, stopping at the next heading', () => {
    expect(sectionFor(changelog, '1.2.0')).toBe('### Added\n\n- the new thing');
  });

  test('reads the last section in the file', () => {
    expect(sectionFor(changelog, '1.1.0')).toBe('- the old thing');
  });

  test('does not confuse 1.1.0 with 1.1.0-adjacent headings', () => {
    // A bare "1.1" must not match the "1.1.0" section - the dots are
    // escaped, so this is a real lookup, not a substring match.
    expect(sectionFor(changelog, '1.1')).toBeNull();
  });

  test('returns null for a version that is not in the file', () => {
    expect(sectionFor(changelog, '9.9.9')).toBeNull();
  });

  test('handles a heading without brackets or a date', () => {
    expect(sectionFor('## 2.0.0\n\n- x\n', '2.0.0')).toBe('- x');
  });
});
