import { Router } from 'express';

const router = Router();

let cache = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos de caché en memoria

// GET /api/firmware/releases — Obtiene el listado de versiones/releases de GitHub
router.get('/releases', async (req, res) => {
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL_MS) {
    return res.json({ source: 'cache', releases: cache });
  }

  try {
    const response = await fetch('https://api.github.com/repos/tecnovend/tecnovend-arduino/releases', {
      headers: {
        'User-Agent': 'VendPoint-API-Server',
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API HTTP ${response.status}`);
    }

    const data = await response.json();
    const releases = data.map(rel => {
      const cleanVer = rel.tag_name.replace(/^v/i, '');
      const binAsset = rel.assets?.find(a => a.name && a.name.endsWith('.bin'));
      const defaultOtaUrl = `https://github.com/tecnovend/tecnovend-arduino/releases/download/v${cleanVer}/firmware-vv${cleanVer}.bin`;
      
      return {
        tag_name: rel.tag_name,
        version: cleanVer,
        name: rel.name || rel.tag_name,
        published_at: rel.published_at,
        prerelease: rel.prerelease,
        ota_url: binAsset?.browser_download_url || defaultOtaUrl,
      };
    });

    cache = releases;
    cacheTime = now;
    res.json({ source: 'github', releases });
  } catch (err) {
    console.error('[firmware] Error al consultar releases de GitHub:', err.message);
    if (cache) {
      return res.json({ source: 'cache_fallback', releases: cache, error: err.message });
    }
    // Fallback básico si falla la llamada inicial
    res.json({
      source: 'fallback',
      releases: [],
      error: err.message,
    });
  }
});

export default router;
