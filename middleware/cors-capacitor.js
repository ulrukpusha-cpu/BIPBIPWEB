/* =========================================================
   BIPBIP — CORS middleware pour APK Capacitor
   Autorise les origines générées par Capacitor (Android & iOS)
   tout en gardant le whitelist habituel du web.

   Usage dans server.js (1 ligne) :
       const corsCapacitor = require('./middleware/cors-capacitor');
       app.use(corsCapacitor());

   À placer AVANT les routes API mais APRÈS app.use(cors(...))
   du paramétrage web habituel si tu en as un.
   ========================================================= */

const cors = require('cors');

// Origines exactes acceptées par défaut
const ALLOWED_ORIGINS = [
  // Production web
  'https://bipbiprecharge.ci',
  'https://www.bipbiprecharge.ci',
  // Capacitor Android : la WebView sert depuis https://localhost
  'https://localhost',
  // Capacitor iOS : capacitor://localhost
  'capacitor://localhost',
  // Ionic / Capacitor compat
  'ionic://localhost',
  // Dev local
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:8090',
  'http://localhost:8091'
];

// Origines à regex (sous-domaines, ports dynamiques)
const ALLOWED_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
  /^https:\/\/.*\.bipbiprecharge\.ci$/i,
  // En cas de tests sur réseau local (LAN preview)
  /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/i,
  /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/i
];

function isOriginAllowed(origin) {
  // Capacitor envoie parfois `null` (file://) ou pas d'origine — on tolère pour le natif
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return ALLOWED_PATTERNS.some(rx => rx.test(origin));
}

/**
 * Retourne le middleware CORS configuré pour APK + web.
 * @param {object} [opts] - extra options forwarded to `cors()`
 */
module.exports = function corsCapacitor(opts = {}) {
  return cors({
    origin: function (origin, callback) {
      if (isOriginAllowed(origin)) return callback(null, true);
      // En dev on log, en prod on rejette silencieusement
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[CORS] origine non autorisée :', origin);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Telegram-Init-Data',
      'X-Capacitor-Platform',
      'X-Admin-Key',
      'X-User-Id',
      'X-Session-Token',
      'X-Telegram-Login-Session',
      'X-Bot-Secret',
      'Accept',
      'Origin',
      'Cache-Control',
      'Pragma',
      'X-Google-Session'
    ],
    exposedHeaders: ['Content-Length', 'X-RateLimit-Remaining'],
    maxAge: 86400, // cache pré-flight 24h
    optionsSuccessStatus: 204,
    ...opts
  });
};

module.exports.isOriginAllowed = isOriginAllowed;
module.exports.ALLOWED_ORIGINS = ALLOWED_ORIGINS;
