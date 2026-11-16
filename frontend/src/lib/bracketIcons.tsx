import type { OlympicBracketTeam } from './brackets';

export function renderBracketTeamIcon(team: OlympicBracketTeam, logoUrl: string | null) {
  if (!logoUrl) {
    return <span className="flagBadge" aria-hidden="true">{team.flag}</span>;
  }

  return (
    <>
      <img
        className="flagLogo"
        src={logoUrl}
        alt={team.name + ' logo'}
        loading="lazy"
        onError={(event) => {
          const img = event.currentTarget;
          img.style.display = 'none';
          const fallback = img.nextElementSibling as HTMLElement | null;
          if (fallback) {
            fallback.style.display = 'grid';
          }
        }}
      />
      <span className="flagBadge teamIconFallback" aria-hidden="true">{team.flag}</span>
    </>
  );
}

export function renderUefaTeamIcon(team: OlympicBracketTeam, logoUrl: string | null) {
  if (!logoUrl) {
    return <span className="flagBadge" aria-hidden="true">⚽</span>;
  }

  return (
    <>
      <img
        className="flagLogo"
        src={logoUrl}
        alt={team.name + ' logo'}
        loading="lazy"
        onError={(event) => {
          const img = event.currentTarget;
          img.style.display = 'none';
          const fallback = img.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = 'grid';
        }}
      />
      <span className="flagBadge teamIconFallback" aria-hidden="true">⚽</span>
    </>
  );
}
