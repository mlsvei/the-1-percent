import type { Contest } from '../api';

export type ContestSportFilter = 'ALL' | 'Basketball' | 'Olympics' | 'Football' | 'Hockey' | 'Baseball' | 'Soccer';

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function fmtDateEastern(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso));
}

export function toLocalDateTimeValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return String(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function countdownWithin24h(iso: string | undefined, nowMs: number): string | null {
  if (!iso) return null;

  const targetMs = new Date(iso).getTime();
  if (!Number.isFinite(targetMs)) return null;

  const deltaMs = targetMs - nowMs;
  if (deltaMs <= 0 || deltaMs > 24 * 60 * 60 * 1000) return null;

  const totalMinutes = Math.floor(deltaMs / (60 * 1000));
  if (totalMinutes <= 0) return 'in <1m';

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return 'in ' + minutes + 'm';
  return 'in ' + hours + 'h ' + minutes + 'm';
}

export function contestTypeLabel(contest: Pick<Contest, 'type' | 'name'>): string {
  if (contest.type === 'PICKEM_NFL') return "NFL Pick'em";
  if (contest.type === 'PICKEM_NBA') return "NBA Pick'em";
  if (contest.type === 'PICKEM_NHL') return "NHL Pick'em";
  if (contest.type === 'STREAK') return 'Streak';
  if (contest.name.toLowerCase().includes('uefa') || contest.name.toLowerCase().includes('champions league')) return 'UEFA Champions League Bracket';
  if (contest.name.toLowerCase().includes('olympic hockey')) return 'Olympic Hockey Bracket';
  if (contest.name.toLowerCase().includes('conference tournament champions')) return "Conference Champions Pick'em";
  return 'Bracket';
}

export function contestMatchesSportFilter(contest: Pick<Contest, 'type' | 'name'>, filter: ContestSportFilter): boolean {
  if (filter === 'ALL') return true;

  const name = contest.name.toLowerCase();
  const isBasketball = contest.type === 'PICKEM_NBA' || name.includes('nba') || name.includes('basketball') || name.includes('ncaam');
  const isOlympics = name.includes('olympic');
  const isFootball = contest.type === 'PICKEM_NFL' || name.includes('nfl') || name.includes('football');
  const isHockey = contest.type === 'PICKEM_NHL' || name.includes('hockey') || name.includes('nhl');
  const isBaseball = name.includes('baseball') || name.includes('mlb');
  const isSoccer = name.includes('soccer') || name.includes('fifa') || name.includes('epl') || name.includes('premier league') || name.includes('uefa') || name.includes('champions league');

  if (filter === 'Basketball') return isBasketball;
  if (filter === 'Olympics') return isOlympics;
  if (filter === 'Football') return isFootball;
  if (filter === 'Hockey') return isHockey;
  if (filter === 'Baseball') return isBaseball;
  if (filter === 'Soccer') return isSoccer;

  return true;
}
