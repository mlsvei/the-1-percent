import type { LeaderboardRow } from '../api';

export function leaderboardDisplayName(row: LeaderboardRow): string {
  return row.displayName;
}

export function rankFromPoints(rows: Array<{ totalPoints: number }>, index: number): number {
  if (index === 0) return 1;
  let rank = 1;
  for (let i = 1; i <= index; i += 1) {
    if (rows[i].totalPoints < rows[i - 1].totalPoints) {
      rank = i + 1;
    }
  }
  return rank;
}

export function rankFromTopOneCount(rows: Array<{ topOneCount: number }>, index: number): number {
  if (index === 0) return 1;
  let rank = 1;
  for (let i = 1; i <= index; i += 1) {
    if (rows[i].topOneCount < rows[i - 1].topOneCount) {
      rank = i + 1;
    }
  }
  return rank;
}

export function rankForUserByPoints(rows: Array<{ userId: string; totalPoints: number }>, rowUserId: string): number | null {
  const index = rows.findIndex((row) => row.userId.trim().toLowerCase() === rowUserId.trim().toLowerCase());
  if (index < 0) return null;
  return rankFromPoints(rows, index);
}

export function percentileFromRank(totalEntries: number, rank: number): number {
  if (totalEntries <= 1) return 100;
  const percentile = ((totalEntries - rank) / (totalEntries - 1)) * 100;
  return Math.max(0, Math.min(100, percentile));
}

export function topOneCutoffPoints(rows: Array<{ totalPoints: number }>): number {
  if (rows.length === 0) return Number.POSITIVE_INFINITY;
  const topCount = Math.max(1, Math.ceil(rows.length * 0.01));
  return rows[Math.min(rows.length - 1, topCount - 1)].totalPoints;
}

export function isTopOnePercentEntry(rows: Array<{ totalPoints: number }>, row: { totalPoints: number }): boolean {
  const cutoff = topOneCutoffPoints(rows);
  return row.totalPoints >= cutoff;
}
