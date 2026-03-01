/**
 * Scoring des actualités (IA) - pour tri / priorisation
 * Stub : retourne un score 0-100. Brancher un modèle IA plus tard.
 */
function scoreActualite(title, content, sources) {
    let score = 50;
    if (sources && String(sources).length > 10) score += 15;
    if (title && title.length >= 20) score += 10;
    if (content && content.length >= 100) score += 10;
    return Math.min(100, Math.max(0, score));
}

module.exports = { scoreActualite };
