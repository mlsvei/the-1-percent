import { Router } from 'express';

export const assetsRouter = Router();

const LEAGUE_MAP: Record<string, 'nba' | 'nhl'> = {
  nba: 'nba',
  nhl: 'nhl'
};

assetsRouter.get('/assets/logo/:league/:abbr', async (req, res) => {
  const league = LEAGUE_MAP[(req.params.league ?? '').toLowerCase()];
  const rawAbbr = (req.params.abbr ?? '').toLowerCase();

  if (!league || !/^[a-z0-9]+$/.test(rawAbbr)) {
    res.status(400).json({ error: 'Invalid logo request' });
    return;
  }

  const url = `https://a.espncdn.com/i/teamlogos/${league}/500/${rawAbbr}.png`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      res.status(404).json({ error: 'Logo not found' });
      return;
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/png';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', contentType);
    res.status(200).send(buffer);
  } catch (error) {
    console.error('[assets] logo proxy failed', { league, rawAbbr, error });
    res.status(502).json({ error: 'Logo fetch failed' });
  }
});
