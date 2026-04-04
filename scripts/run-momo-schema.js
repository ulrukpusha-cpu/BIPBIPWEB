/**
 * Exécute database/schema-momo-complet.sql sur Supabase.
 * Nécessite dans .env : SUPABASE_DB_URL=postgresql://postgres.[ref]:[MOT_DE_PASSE]@aws-0-[region].pooler.supabase.com:6543/postgres
 * (Récupérer dans Supabase : Project Settings > Database > Connection string > URI)
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl || !dbUrl.startsWith('postgresql://')) {
    console.error('❌ SUPABASE_DB_URL manquant dans .env');
    console.error('   Ajoute l’URL de connexion (Supabase > Project Settings > Database > Connection string > URI)');
    process.exit(1);
}

const sqlPath = path.join(__dirname, '..', 'database', 'schema-momo-complet.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

async function run() {
    const { Client } = require('pg');
    const client = new Client({ connectionString: dbUrl });
    try {
        await client.connect();
        await client.query(sql);
        console.log('✅ Schéma momo_transactions exécuté avec succès.');
    } catch (err) {
        console.error('❌ Erreur:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

run();
