import { describe, it, expect } from 'vitest';
import { extractActivityId } from '../src/resolver/normalizeUrl';
import { descriptiveSlug, slugsMatch } from '../src/resolver/resolveShareUrl';

describe('extractActivityId', () => {
  it('extracts the numeric id after -activity-', () => {
    expect(
      extractActivityId(
        'https://www.linkedin.com/posts/goodera_x-activity-7472415145487421441-UGd2/',
      ),
    ).toBe('7472415145487421441');
  });

  it('works without trailing slug suffix', () => {
    expect(
      extractActivityId('https://www.linkedin.com/posts/x-activity-123456789'),
    ).toBe('123456789');
  });

  it('returns null when there is no activity id', () => {
    expect(
      extractActivityId('https://www.linkedin.com/posts/x-share-123-ab/'),
    ).toBeNull();
  });

  it('returns null for non-numeric activity segment', () => {
    expect(
      extractActivityId('https://www.linkedin.com/posts/x-activity-notanumber/'),
    ).toBeNull();
  });
});

describe('descriptiveSlug', () => {
  it('extracts slug from a share url (no author prefix)', () => {
    expect(
      descriptiveSlug(
        'https://www.linkedin.com/posts/were-headed-to-london-were-excited-share-7472364428009680896-yWay',
      ),
    ).toBe('were-headed-to-london-were-excited');
  });

  it('strips the author prefix from an activity url', () => {
    expect(
      descriptiveSlug(
        'https://www.linkedin.com/posts/goodera_were-headed-to-london-were-excited-activity-7472415145487421441-UGd2/',
      ),
    ).toBe('were-headed-to-london-were-excited');
  });
});

describe('slugsMatch', () => {
  it('matches identical slugs', () => {
    expect(slugsMatch('a-b-c', 'a-b-c')).toBe(true);
  });
  it('matches the real share/activity slug pair', () => {
    const share = 'were-headed-to-london-were-excited';
    const activity = 'were-headed-to-london-were-excited';
    expect(slugsMatch(share, activity)).toBe(true);
  });
  it('matches on strong token overlap', () => {
    expect(slugsMatch('headed-to-london-excited', 'headed-to-london-thrilled')).toBe(true);
  });
  it('does not match unrelated slugs', () => {
    expect(slugsMatch('quarterly-earnings-report', 'cat-video-funny-moment')).toBe(false);
  });
  it('returns false when either slug is null', () => {
    expect(slugsMatch(null, 'x')).toBe(false);
    expect(slugsMatch('x', null)).toBe(false);
  });
});
