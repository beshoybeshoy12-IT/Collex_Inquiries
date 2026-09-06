import { InvestigatorAvailability } from '@prisma/client';
import {
  CandidateInvestigator,
  CaseRequirements,
  haversineKm,
  rankCandidates,
} from './auto-assign.engine';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Candidate ranking.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  This engine does not assign anybody — the brief is explicit that a
 *  coordinator decides. What it produces is a sorted list with reasons, and a
 *  coordinator who trusts that list will take the top row most of the time.
 *  That makes the ORDER a real decision, even though the code never writes an
 *  Assignment row.
 *
 *  Two properties are worth more than any individual weight, and are what most
 *  of this file tests:
 *
 *    1. An ineligible candidate never outranks an eligible one, however good
 *       their numbers are. Someone on leave with a perfect record cannot do the
 *       visit.
 *
 *    2. Nobody is silently dropped. A blocked candidate stays in the list with
 *       their blockers spelled out, because "why is Ahmed not on this list" is
 *       a question a coordinator asks, and a filtered list cannot answer it.
 */

const CAIRO = { lat: 30.0444, lng: 31.2357 };
const ALEXANDRIA = { lat: 31.2001, lng: 29.9187 };
const ASWAN = { lat: 24.0889, lng: 32.8998 };

const candidate = (
  overrides: Partial<CandidateInvestigator> = {},
): CandidateInvestigator => ({
  id: 'inv-1',
  fullName: 'Ahmed Hassan',
  employeeCode: 'INV-001',
  availability: InvestigatorAvailability.AVAILABLE,
  governorateIds: ['gov-cairo'],
  cityIds: ['city-nasr'],
  districtIds: ['district-7'],
  areaIds: [],
  investigationTypeIds: ['type-home'],
  productIds: ['product-cards'],
  maxOpenCases: 10,
  openCases: 2,
  qualityScore: null,
  avgTatMinutes: null,
  completedCount: 0,
  rejectedCount: 0,
  lastLat: null,
  lastLng: null,
  ...overrides,
});

const requirements = (
  overrides: Partial<CaseRequirements> = {},
): CaseRequirements => ({
  investigationTypeId: 'type-home',
  productId: 'product-cards',
  governorateId: 'gov-cairo',
  cityId: 'city-nasr',
  districtId: 'district-7',
  areaId: null,
  targetLat: null,
  targetLng: null,
  ...overrides,
});

const rankOne = (
  overrides: Partial<CandidateInvestigator> = {},
  req: Partial<CaseRequirements> = {},
) => rankCandidates([candidate(overrides)], requirements(req))[0];

describe('haversineKm', () => {
  it('is zero for a point against itself', () => {
    expect(haversineKm(CAIRO.lat, CAIRO.lng, CAIRO.lat, CAIRO.lng)).toBe(0);
  });

  it('gets Cairo to Alexandria about right', () => {
    // ~180 km as the crow flies. A generous band, because the point is that
    // the formula is not off by a factor of the earth's radius or a degrees/
    // radians conversion — both of which still produce plausible-looking
    // numbers.
    const km = haversineKm(
      CAIRO.lat,
      CAIRO.lng,
      ALEXANDRIA.lat,
      ALEXANDRIA.lng,
    );
    expect(km).toBeGreaterThan(160);
    expect(km).toBeLessThan(200);
  });

  it('gets Cairo to Aswan about right', () => {
    const km = haversineKm(CAIRO.lat, CAIRO.lng, ASWAN.lat, ASWAN.lng);
    expect(km).toBeGreaterThan(600);
    expect(km).toBeLessThan(700);
  });

  it('is symmetric', () => {
    const there = haversineKm(CAIRO.lat, CAIRO.lng, ASWAN.lat, ASWAN.lng);
    const back = haversineKm(ASWAN.lat, ASWAN.lng, CAIRO.lat, CAIRO.lng);
    expect(there).toBeCloseTo(back, 6);
  });
});

describe('rankCandidates', () => {
  describe('eligibility beats score', () => {
    it('sorts every eligible candidate above every blocked one', () => {
      // The star performer is on leave. They cannot do the visit today, so
      // they cannot be the top row — however good their numbers look.
      const star = candidate({
        id: 'star',
        availability: InvestigatorAvailability.ON_LEAVE,
        qualityScore: 100,
        avgTatMinutes: 60,
        openCases: 0,
      });
      const ordinary = candidate({
        id: 'ordinary',
        qualityScore: 40,
        openCases: 8,
      });

      const ranked = rankCandidates([star, ordinary], requirements());
      expect(ranked[0].investigatorId).toBe('ordinary');
      expect(ranked[0].eligible).toBe(true);
      expect(ranked[1].investigatorId).toBe('star');
      expect(ranked[1].eligible).toBe(false);
      // ... and the blocked one really did score higher.
      expect(ranked[1].score).toBeGreaterThan(ranked[0].score);
    });

    it('keeps blocked candidates in the list instead of filtering them out', () => {
      // "Why isn't Ahmed on this list?" is a question a coordinator will ask.
      // A filtered list cannot answer it.
      const ranked = rankCandidates(
        [
          candidate({ id: 'a' }),
          candidate({
            id: 'b',
            availability: InvestigatorAvailability.ON_LEAVE,
          }),
          candidate({ id: 'c', openCases: 10, maxOpenCases: 10 }),
        ],
        requirements(),
      );
      expect(ranked).toHaveLength(3);
      expect(ranked.map((r) => r.investigatorId).sort()).toEqual([
        'a',
        'b',
        'c',
      ]);
    });

    it('sorts eligible candidates among themselves by score', () => {
      const ranked = rankCandidates(
        [
          candidate({ id: 'busy', openCases: 9 }),
          candidate({ id: 'free', openCases: 0 }),
          candidate({ id: 'middling', openCases: 5 }),
        ],
        requirements(),
      );
      expect(ranked.map((r) => r.investigatorId)).toEqual([
        'free',
        'middling',
        'busy',
      ]);
      expect(ranked[0].score).toBeGreaterThan(ranked[2].score);
    });
  });

  describe('blockers', () => {
    it('blocks someone on leave', () => {
      const result = rankOne({
        availability: InvestigatorAvailability.ON_LEAVE,
      });
      expect(result.eligible).toBe(false);
      expect(result.blockers.join(' ')).toContain('On leave');
    });

    it('blocks someone at their case ceiling', () => {
      const result = rankOne({ openCases: 10, maxOpenCases: 10 });
      expect(result.eligible).toBe(false);
      expect(result.blockers.join(' ')).toContain('At capacity');
      expect(result.factors.workload).toBe(0);
    });

    it('blocks someone already over their ceiling', () => {
      // Over-capacity happens: a ceiling can be lowered while cases are open.
      // It must read as blocked, not as negative spare capacity.
      const result = rankOne({ openCases: 14, maxOpenCases: 10 });
      expect(result.eligible).toBe(false);
      expect(result.factors.workload).toBe(0);
    });

    it('blocks someone whose ceiling is zero', () => {
      // maxOpenCases 0 is how a tenant benches an investigator without
      // deactivating them.
      const result = rankOne({ maxOpenCases: 0, openCases: 0 });
      expect(result.eligible).toBe(false);
    });

    it('blocks someone not qualified for the investigation type', () => {
      const result = rankOne({ investigationTypeIds: ['type-workplace'] });
      expect(result.eligible).toBe(false);
      expect(result.blockers.join(' ')).toContain(
        'Not qualified for this investigation type',
      );
    });

    it('blocks someone not qualified for the product', () => {
      const result = rankOne({ productIds: ['product-loans'] });
      expect(result.eligible).toBe(false);
      expect(result.blockers.join(' ')).toContain(
        'Not qualified for this product',
      );
    });

    it('blocks someone outside the coverage area', () => {
      const result = rankOne({
        governorateIds: ['gov-alex'],
        cityIds: [],
        districtIds: [],
      });
      expect(result.eligible).toBe(false);
      expect(result.blockers.join(' ')).toContain('Outside coverage area');
      expect(result.factors.coverage).toBe(0);
    });

    it('reports every blocker at once, not just the first', () => {
      // A coordinator deciding whether to override needs the whole picture.
      const result = rankOne({
        availability: InvestigatorAvailability.ON_LEAVE,
        openCases: 10,
        maxOpenCases: 10,
        productIds: ['product-loans'],
      });
      expect(result.blockers.length).toBeGreaterThanOrEqual(3);
    });

    it('writes every blocker in both Arabic and English', () => {
      // These strings go straight onto the assignment screen, which is
      // bilingual. A blocker only an English reader can act on is a bug.
      const result = rankOne({
        availability: InvestigatorAvailability.ON_LEAVE,
        productIds: ['product-loans'],
        governorateIds: ['gov-alex'],
        cityIds: [],
        districtIds: [],
        openCases: 10,
        maxOpenCases: 10,
      });
      expect(result.blockers.length).toBeGreaterThan(0);
      for (const blocker of result.blockers) {
        expect(blocker).toMatch(/[؀-ۿ]/); // Arabic
        expect(blocker).toMatch(/[A-Za-z]/); // English
        expect(blocker).toContain(' - ');
      }
    });

    it('does not block someone merely because they are busy or offline', () => {
      // BUSY and OFFLINE are states, not disqualifications — an offline
      // investigator is one whose phone is not currently reporting, and a case
      // assigned now is picked up when they open the app.
      for (const availability of [
        InvestigatorAvailability.BUSY,
        InvestigatorAvailability.OFFLINE,
        InvestigatorAvailability.ON_VISIT,
      ]) {
        expect(rankOne({ availability }).eligible).toBe(true);
      }
    });
  });

  describe('coverage scoring', () => {
    it('scores a more specific match higher', () => {
      const area = rankOne({ areaIds: ['area-1'] }, { areaId: 'area-1' })
        .factors.coverage;
      const district = rankOne({}, { areaId: null }).factors.coverage;
      const city = rankOne({ districtIds: [] }, { districtId: null }).factors
        .coverage;
      const governorate = rankOne(
        { districtIds: [], cityIds: [] },
        { districtId: null, cityId: null },
      ).factors.coverage;

      expect(area).toBeGreaterThan(district);
      expect(district).toBeGreaterThan(city);
      expect(city).toBeGreaterThan(governorate);
      expect(governorate).toBeGreaterThan(0);
    });

    it('treats an unconfigured investigator as unrestricted, not as uncovered', () => {
      // A tenant that has not set up geography yet must get a usable ranking
      // rather than a screen of zeroes with everyone blocked.
      const result = rankOne({
        governorateIds: [],
        cityIds: [],
        districtIds: [],
        areaIds: [],
      });
      expect(result.eligible).toBe(true);
      expect(result.factors.coverage).toBeGreaterThan(0);
      expect(result.notes.join(' ')).toContain('No coverage restrictions');
    });

    it('does not block on coverage when the case itself has no geography', () => {
      // An imported case with no governorate cannot be outside anyone's area.
      const result = rankOne(
        { governorateIds: ['gov-alex'], cityIds: [], districtIds: [] },
        { governorateId: null, cityId: null, districtId: null },
      );
      expect(result.blockers.join(' ')).not.toContain('Outside coverage');
    });
  });

  describe('quality scoring', () => {
    it('scores an unproven investigator at the midpoint, not the bottom', () => {
      // Scoring a newcomer at zero means they are never assigned anything and
      // therefore never become proven. This is the rule that stops the ranking
      // being self-fulfilling.
      const result = rankOne({
        qualityScore: null,
        completedCount: 0,
        rejectedCount: 0,
      });
      expect(result.factors.quality).toBe(0.5);
    });

    it('prefers an explicit quality score over the derived one', () => {
      const result = rankOne({
        qualityScore: 90,
        completedCount: 1,
        rejectedCount: 99,
      });
      expect(result.factors.quality).toBeCloseTo(0.9, 5);
    });

    it('derives quality from history when no score is stored', () => {
      const result = rankOne({
        qualityScore: null,
        completedCount: 8,
        rejectedCount: 2,
      });
      expect(result.factors.quality).toBeCloseTo(0.8, 5);
    });

    it('clamps an out-of-range stored score instead of trusting it', () => {
      expect(rankOne({ qualityScore: 150 }).factors.quality).toBe(1);
      expect(rankOne({ qualityScore: -20 }).factors.quality).toBe(0);
    });

    it('does not let quality alone decide the order', () => {
      // Quality is 15 of 100. Ranking primarily on it sends every case to the
      // best three people, who then breach their SLAs while everyone idles.
      const best = candidate({ id: 'best', qualityScore: 100, openCases: 9 });
      const spare = candidate({ id: 'spare', qualityScore: 60, openCases: 0 });
      const ranked = rankCandidates([best, spare], requirements());
      expect(ranked[0].investigatorId).toBe('spare');
    });
  });

  describe('speed scoring', () => {
    it('is neutral with no turnaround history', () => {
      expect(rankOne({ avgTatMinutes: null }).factors.speed).toBe(0.5);
      expect(rankOne({ avgTatMinutes: 0 }).factors.speed).toBe(0.5);
    });

    it('scores a faster investigator above a slower one', () => {
      const fast = rankOne({ avgTatMinutes: 6 * 60 }).factors.speed;
      const slow = rankOne({ avgTatMinutes: 96 * 60 }).factors.speed;
      expect(fast).toBeGreaterThan(slow);
    });

    it('clamps rather than rewarding an implausibly fast average', () => {
      // A one-minute average turnaround is a data problem, not a superstar.
      expect(rankOne({ avgTatMinutes: 1 }).factors.speed).toBe(1);
    });
  });

  describe('proximity scoring', () => {
    it('is neutral when either position is unknown', () => {
      // An investigator whose phone has not reported must not be penalised
      // against one whose has — that ranks the handset, not the person.
      expect(rankOne({ lastLat: null, lastLng: null }).factors.proximity).toBe(
        0.5,
      );
      expect(
        rankOne(
          { lastLat: CAIRO.lat, lastLng: CAIRO.lng },
          { targetLat: null, targetLng: null },
        ).factors.proximity,
      ).toBe(0.5);
    });

    it('scores a nearby investigator above a distant one', () => {
      const near = rankOne(
        { lastLat: CAIRO.lat, lastLng: CAIRO.lng },
        { targetLat: CAIRO.lat, targetLng: CAIRO.lng },
      );
      const far = rankOne(
        { lastLat: ALEXANDRIA.lat, lastLng: ALEXANDRIA.lng },
        { targetLat: CAIRO.lat, targetLng: CAIRO.lng },
      );
      expect(near.factors.proximity).toBeGreaterThan(far.factors.proximity);
      expect(near.factors.proximity).toBeCloseTo(1, 2);
    });

    it('floors at zero past the useful range rather than going negative', () => {
      // Beyond ~50 km the difference between 200 and 600 km does not change
      // the decision, and a negative factor would drag the total below what an
      // unlocated candidate scores.
      const result = rankOne(
        { lastLat: ASWAN.lat, lastLng: ASWAN.lng },
        { targetLat: CAIRO.lat, targetLng: CAIRO.lng },
      );
      expect(result.factors.proximity).toBe(0);
    });

    it('reports the distance as a note so the screen can show it', () => {
      const result = rankOne(
        { lastLat: ALEXANDRIA.lat, lastLng: ALEXANDRIA.lng },
        { targetLat: CAIRO.lat, targetLng: CAIRO.lng },
      );
      expect(result.notes.join(' ')).toMatch(/km from last known position/);
    });
  });

  describe('the shape of the result', () => {
    it('keeps every factor on a 0–1 scale', () => {
      // The factors are shown to a coordinator as a breakdown. A factor
      // outside 0–1 makes the bar chart beside it meaningless.
      const ranked = rankCandidates(
        [
          candidate({ id: 'a', qualityScore: 100, avgTatMinutes: 1 }),
          candidate({ id: 'b', qualityScore: 0, avgTatMinutes: 100000 }),
          candidate({ id: 'c', openCases: 30, maxOpenCases: 10 }),
        ],
        requirements(),
      );
      for (const row of ranked) {
        for (const [name, value] of Object.entries(row.factors)) {
          expect(`${name}=${value}`).toBe(
            `${name}=${Math.max(0, Math.min(1, value))}`,
          );
        }
      }
    });

    it('cannot exceed 100 even for a perfect candidate', () => {
      const perfect = rankOne(
        {
          areaIds: ['area-1'],
          qualityScore: 100,
          avgTatMinutes: 60,
          openCases: 0,
          lastLat: CAIRO.lat,
          lastLng: CAIRO.lng,
        },
        { areaId: 'area-1', targetLat: CAIRO.lat, targetLng: CAIRO.lng },
      );
      expect(perfect.score).toBeLessThanOrEqual(100);
      expect(perfect.score).toBeGreaterThan(90);
      expect(perfect.eligible).toBe(true);
    });

    it('carries enough identity to render a row without a second query', () => {
      const result = rankOne();
      expect(result.fullName).toBe('Ahmed Hassan');
      expect(result.employeeCode).toBe('INV-001');
      expect(result.openCases).toBe(2);
      expect(result.maxOpenCases).toBe(10);
    });

    it('handles an empty candidate list without throwing', () => {
      expect(rankCandidates([], requirements())).toEqual([]);
    });

    it('is pure — it does not mutate the candidates it is given', () => {
      // The caller passes rows straight out of Prisma. Mutating them would
      // corrupt whatever else holds a reference.
      const input = candidate();
      const snapshot = JSON.stringify(input);
      rankCandidates([input], requirements());
      expect(JSON.stringify(input)).toBe(snapshot);
    });
  });
});
