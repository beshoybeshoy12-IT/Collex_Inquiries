import { InvestigatorAvailability } from '@prisma/client';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Candidate ranking.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  This scores investigators for a case. It does not assign anybody, and
 *  nothing in the system calls it on a timer — the brief is explicit that
 *  manual coordinator assignment is the business requirement and must not be
 *  bypassed. What a coordinator gets is a sorted list with the reasoning
 *  attached; what they do with it is their decision.
 *
 *  The function is pure, which is the point: every input is passed in, so the
 *  weights can be tested exhaustively without a database, and the whole thing
 *  can later be called from a background job without moving a line of it.
 *
 *  WEIGHTS, AND WHY THESE
 *
 *    coverage   35  — an investigator who does not work that area cannot do
 *                     the visit at all, so this dominates everything else.
 *    skills     20  — qualified for the type and the product.
 *    workload   20  — spare capacity, so work spreads rather than piling on
 *                     whoever happens to score well on quality.
 *    quality    15  — historical QC pass rate.
 *    speed       5  — average turnaround.
 *    proximity   5  — distance from their last known position, when known.
 *
 *  Quality is deliberately not dominant. Ranking primarily on quality sends
 *  every case to the best three people, who then breach their SLAs while
 *  everyone else idles — and their scores fall as a result. Coverage and
 *  capacity are the constraints that actually decide whether a visit happens.
 */

export interface CandidateInvestigator {
  id: string;
  fullName: string;
  employeeCode: string;
  availability: InvestigatorAvailability;
  governorateIds: string[];
  cityIds: string[];
  districtIds: string[];
  areaIds: string[];
  investigationTypeIds: string[];
  productIds: string[];
  maxOpenCases: number;
  openCases: number;
  qualityScore: number | null;
  avgTatMinutes: number | null;
  completedCount: number;
  rejectedCount: number;
  lastLat: number | null;
  lastLng: number | null;
}

export interface CaseRequirements {
  investigationTypeId: string;
  productId: string;
  governorateId: string | null;
  cityId: string | null;
  districtId: string | null;
  areaId: string | null;
  targetLat: number | null;
  targetLng: number | null;
}

export interface RankedCandidate {
  investigatorId: string;
  fullName: string;
  employeeCode: string;
  score: number;
  eligible: boolean;
  openCases: number;
  maxOpenCases: number;
  /** Human-readable, bilingual, so the screen can show why. */
  factors: {
    coverage: number;
    skills: number;
    workload: number;
    quality: number;
    speed: number;
    proximity: number;
  };
  blockers: string[];
  notes: string[];
}

const WEIGHTS = {
  coverage: 35,
  skills: 20,
  workload: 20,
  quality: 15,
  speed: 5,
  proximity: 5,
} as const;

/** A typical turnaround, used to normalise speed onto 0–1. */
const TARGET_TAT_MINUTES = 24 * 60;

/**
 * Great-circle distance in kilometres.
 *
 * Straight-line rather than driving distance: this is a ranking hint, and
 * calling a routing API once per candidate per case would put a paid network
 * round trip on the assignment screen's critical path.
 */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Coverage, 0–1, most specific match first.
 *
 * An empty coverage list means "no restriction" and scores as a neutral
 * governorate-level match — a tenant that has not configured geography yet
 * should get a usable ranking rather than a screen of zeroes.
 */
function scoreCoverage(
  candidate: CandidateInvestigator,
  requirements: CaseRequirements,
): { score: number; note: string | null; blocked: boolean } {
  const unrestricted =
    candidate.governorateIds.length === 0 &&
    candidate.cityIds.length === 0 &&
    candidate.districtIds.length === 0 &&
    candidate.areaIds.length === 0;

  if (unrestricted) {
    return {
      score: 0.6,
      note: 'No coverage restrictions configured',
      blocked: false,
    };
  }

  if (requirements.areaId && candidate.areaIds.includes(requirements.areaId)) {
    return { score: 1, note: 'Covers this exact area', blocked: false };
  }
  if (
    requirements.districtId &&
    candidate.districtIds.includes(requirements.districtId)
  ) {
    return { score: 0.9, note: 'Covers this district', blocked: false };
  }
  if (requirements.cityId && candidate.cityIds.includes(requirements.cityId)) {
    return { score: 0.8, note: 'Covers this city', blocked: false };
  }
  if (
    requirements.governorateId &&
    candidate.governorateIds.includes(requirements.governorateId)
  ) {
    return { score: 0.7, note: 'Covers this governorate', blocked: false };
  }

  return {
    score: 0,
    note: null,
    blocked: Boolean(requirements.governorateId),
  };
}

function scoreSkills(
  candidate: CandidateInvestigator,
  requirements: CaseRequirements,
): { score: number; blockers: string[] } {
  const blockers: string[] = [];
  let score = 0;

  const typeOk =
    candidate.investigationTypeIds.length === 0 ||
    candidate.investigationTypeIds.includes(requirements.investigationTypeId);
  const productOk =
    candidate.productIds.length === 0 ||
    candidate.productIds.includes(requirements.productId);

  if (typeOk) score += 0.6;
  else
    blockers.push(
      'غير مؤهل لنوع التحقيق - Not qualified for this investigation type',
    );

  if (productOk) score += 0.4;
  else blockers.push('غير مؤهل للمنتج - Not qualified for this product');

  return { score, blockers };
}

/** Spare capacity, 0–1. Someone at capacity scores zero and is blocked. */
function scoreWorkload(candidate: CandidateInvestigator): {
  score: number;
  blocked: boolean;
} {
  if (candidate.maxOpenCases <= 0) return { score: 0, blocked: true };
  const free = candidate.maxOpenCases - candidate.openCases;
  if (free <= 0) return { score: 0, blocked: true };
  return { score: Math.min(1, free / candidate.maxOpenCases), blocked: false };
}

/**
 * Quality, 0–1.
 *
 * Someone with no history scores 0.5 rather than 0 — a new investigator with no
 * completed cases is unproven, not bad, and scoring them at the bottom means
 * they are never assigned anything and therefore never become proven.
 */
function scoreQuality(candidate: CandidateInvestigator): number {
  if (candidate.qualityScore !== null) {
    return Math.max(0, Math.min(1, candidate.qualityScore / 100));
  }

  const total = candidate.completedCount + candidate.rejectedCount;
  if (total === 0) return 0.5;
  return candidate.completedCount / total;
}

function scoreSpeed(candidate: CandidateInvestigator): number {
  if (!candidate.avgTatMinutes || candidate.avgTatMinutes <= 0) return 0.5;
  // Faster than target scores above 0.5, slower below, clamped either way.
  return Math.max(
    0,
    Math.min(1, TARGET_TAT_MINUTES / candidate.avgTatMinutes / 2),
  );
}

/** Proximity, 0–1. Neutral when either position is unknown. */
function scoreProximity(
  candidate: CandidateInvestigator,
  requirements: CaseRequirements,
): { score: number; distanceKm: number | null } {
  if (
    candidate.lastLat === null ||
    candidate.lastLng === null ||
    requirements.targetLat === null ||
    requirements.targetLng === null
  ) {
    return { score: 0.5, distanceKm: null };
  }

  const distanceKm = haversineKm(
    candidate.lastLat,
    candidate.lastLng,
    requirements.targetLat,
    requirements.targetLng,
  );

  // Linear to 50 km, then flat: past that everything is "far" and the
  // difference between 60 and 90 km does not change the decision.
  return { score: Math.max(0, 1 - distanceKm / 50), distanceKm };
}

/** Score and sort. Ineligible candidates are kept, with their blockers. */
export function rankCandidates(
  candidates: CandidateInvestigator[],
  requirements: CaseRequirements,
): RankedCandidate[] {
  const ranked = candidates.map((candidate): RankedCandidate => {
    const blockers: string[] = [];
    const notes: string[] = [];

    const coverage = scoreCoverage(candidate, requirements);
    if (coverage.blocked) {
      blockers.push('خارج نطاق التغطية - Outside coverage area');
    }
    if (coverage.note) notes.push(coverage.note);

    const skills = scoreSkills(candidate, requirements);
    blockers.push(...skills.blockers);

    const workload = scoreWorkload(candidate);
    if (workload.blocked) {
      blockers.push(
        `وصل للحد الأقصى (${candidate.openCases}/${candidate.maxOpenCases}) - ` +
          `At capacity (${candidate.openCases}/${candidate.maxOpenCases})`,
      );
    }

    if (candidate.availability === InvestigatorAvailability.ON_LEAVE) {
      blockers.push('في إجازة - On leave');
    }

    const quality = scoreQuality(candidate);
    const speed = scoreSpeed(candidate);
    const proximity = scoreProximity(candidate, requirements);
    if (proximity.distanceKm !== null) {
      notes.push(
        `~${Math.round(proximity.distanceKm)} km from last known position`,
      );
    }

    const factors = {
      coverage: coverage.score,
      skills: skills.score,
      workload: workload.score,
      quality,
      speed,
      proximity: proximity.score,
    };

    const score =
      factors.coverage * WEIGHTS.coverage +
      factors.skills * WEIGHTS.skills +
      factors.workload * WEIGHTS.workload +
      factors.quality * WEIGHTS.quality +
      factors.speed * WEIGHTS.speed +
      factors.proximity * WEIGHTS.proximity;

    return {
      investigatorId: candidate.id,
      fullName: candidate.fullName,
      employeeCode: candidate.employeeCode,
      score: Math.round(score * 10) / 10,
      eligible: blockers.length === 0,
      openCases: candidate.openCases,
      maxOpenCases: candidate.maxOpenCases,
      factors,
      blockers,
      notes,
    };
  });

  // Eligible first, then by score. An ineligible candidate with a high score is
  // still ineligible, and burying them below eligible ones is what a
  // coordinator scanning the list expects.
  return ranked.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.score - a.score;
  });
}
