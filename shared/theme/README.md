# Bipbip Recharge — Seasonal Theme Engine

Vanilla JS/CSS module shared between the **site** (`index.html` / public marketing) and the **app** (`app.html` / installable PWA). Distilled from `BIPBIPTHEME/themes.jsx`.

## Files

| File                     | Purpose                                                   |
|--------------------------|-----------------------------------------------------------|
| `seasons.json`           | Active windows for each of the 9 seasons (priority order) |
| `theme-tokens.css`       | CSS custom properties per `:root[data-season="<id>"]`     |
| `theme-particles.css`    | Particle keyframes + overlay layout                       |
| `theme-engine.js`        | Detect active season + apply + mount particles            |

## Usage

Add a single line to any page:

```html
<script defer src="/shared/theme/theme-engine.js"></script>
```

The engine auto-bootstraps:
1. injects `theme-tokens.css` + `theme-particles.css` if not already present,
2. fetches `seasons.json`,
3. detects the current season (or `?season=<id>` URL override / `localStorage` override),
4. sets `<html data-season="...">`,
5. mounts a particle overlay (skipped under `prefers-reduced-motion` or `html.bipbip-lite`).

## Available CSS variables

`--bb-bg`, `--bb-text`, `--bb-muted`, `--bb-card-bg`, `--bb-tile-bg`, `--bb-tile-border`, `--bb-divider`, `--bb-accent`, `--bb-good`, `--bb-warn`, `--bb-hero-bg`, `--bb-hero-text`, `--bb-hero-border`, `--bb-hero-label`, `--bb-hero-shadow`, `--bb-cta-bg`, `--bb-cta-text`, `--bb-cta-shadow`, `--bb-tile1..4`, `--bb-display-font`, `--bb-mode`, `--bb-bg-decor`.

## Helper classes

`.bb-themed-bg`, `.bb-themed-hero`, `.bb-themed-card`, `.bb-themed-tile`, `.bb-themed-cta`, `.bb-themed-accent`, `.bb-display-font`.

## Override

| Method                 | Example                                          | Persists?  |
|------------------------|--------------------------------------------------|------------|
| URL parameter          | `?season=noel`, `?season=none`                   | Per request|
| `localStorage`         | `BipbipTheme.setOverride("halloween")`           | Yes        |
| JS                     | `BipbipTheme.apply("ete")` then mount particles  | Volatile   |
| Reset                  | `BipbipTheme.setOverride(null)`                  | —          |

## Seasons (priority order)

1. Nouvel An (12-26 → 01-06)
2. Saint-Valentin (02-10 → 02-15)
3. Ramadan / Aïd (explicit dates 2026–2028)
4. Pâques (explicit dates 2026–2028)
5. Indépendance CI (08-05 → 08-09)
6. Rentrée scolaire (09-01 → 09-15)
7. Halloween (10-25 → 11-01)
8. Noël (12-15 → 12-25)
9. Été / Vacances (06-21 → 08-31, **excluded** during Indépendance)
