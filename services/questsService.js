/**
 * Quêtes : liste active, progression user, complétion
 */
const db = require('../database/supabase-client');

async function listActiveQuests() {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const { data } = await supabase.from('quests').select('*').eq('is_active', true).order('points_reward', { ascending: false });
    return data || [];
}

async function getUserProgress(userId) {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const { data } = await supabase.from('user_quests').select('*, quests(*)').eq('user_id', String(userId));
    return data || [];
}

async function getOrCreateUserQuest(userId, questId) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    let { data } = await supabase.from('user_quests').select('*').eq('user_id', String(userId)).eq('quest_id', questId).single();
    if (!data) {
        const { data: inserted } = await supabase.from('user_quests').insert({
            user_id: String(userId),
            quest_id: questId,
            progress: 0,
            completed: false,
        }).select().single();
        data = inserted;
    }
    return data;
}

async function setProgress(userId, questId, progress, completed = false) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const payload = { progress };
    if (completed) {
        payload.completed = true;
        payload.completed_at = new Date().toISOString();
    }
    const { data } = await supabase.from('user_quests').update(payload).eq('user_id', String(userId)).eq('quest_id', questId).select().single();
    return data;
}

async function completeQuest(userId, questId) {
    return setProgress(userId, questId, 999, true);
}

module.exports = {
    listActiveQuests,
    getUserProgress,
    getOrCreateUserQuest,
    setProgress,
    completeQuest,
};
