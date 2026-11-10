const db = require('./db');
const catalog = require('./catalog');

let googlePlugin = null;
try { googlePlugin = require('../ai_plugins/google_gemini_plugin'); } catch (e) {}
let bratukhaPlugin = null;
try { bratukhaPlugin = require('../ai_plugins/bratukha_plugin'); } catch (e) {}
let gigaPlugin = null;
try { gigaPlugin = require('../ai_plugins/gigachat_plugin'); } catch (e) {}

const PLUGINS = { google: googlePlugin, bratukha: bratukhaPlugin, giga: gigaPlugin };

function getPlugin(model) {
    return PLUGINS[model.provider] || null;
}

// Пользователи, у которых уже выполняется генерация (единый замок для бота и веба).
const busy = new Set();

function isBusy(userId) {
    return busy.has(String(userId));
}

class GenError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code || 'error';
    }
}

// Общая проверка перед генерацией: возвращает подготовленные данные либо кидает GenError.
function limitMessage(slot) {
    if (slot.limit === 0) return 'Эта бесплатная модель сейчас без доступных генераций. Лимит можно изменить в админке.';
    return `Лимит бесплатной модели на сегодня исчерпан: ${slot.used}/${slot.limit}. Завтра по Москве счётчик обнулится.`;
}

async function prepare({ userId, modelKey, hasImage, hasText, charge, strict }) {
    const id = String(userId);
    const user = await db.getUser(id);
    if (user.blocked) throw new GenError('Аккаунт в чёрном списке', 'blocked');

    let model = catalog.getModel(modelKey);
    if (!model && !strict) model = catalog.getModel(catalog.defaultModelKey());
    if (!model) throw new GenError('Модель недоступна', 'no_model');
    const plugin = getPlugin(model);
    if (!plugin || !plugin.processRequest) throw new GenError('Модель временно недоступна', 'no_plugin');

    if (model.image === 'required' && !hasImage) throw new GenError('Для этой модели нужно прикрепить изображение', 'need_image');
    if (model.image !== 'required' && !hasText && !hasImage) throw new GenError('Введите текст запроса', 'need_text');

    if (model.provider === 'giga') {
        const lim = await db.peekGiga(id, model.key, model.limit);
        if (!lim.ok) throw new GenError(limitMessage(lim), 'limit');
    }

    const price = Number.isFinite(Number(charge)) ? Math.max(0, Math.round(Number(charge))) : model.cost;
    if (Number(user.balance) < price) {
        throw new GenError(`Недостаточно кредитов: ${user.balance}, нужно ${price}`, 'no_credits');
    }

    return { user, model, plugin, price };
}

// Выполняет генерацию: держит замок, списывает кредиты и фиксирует статистику.
async function run({ userId, prompt, model, plugin, fileBuffer, fileBuffers, mimeType, aspectRatio, charge, reason, keepModel }) {
    const id = String(userId);
    if (busy.has(id)) throw new GenError('Дождитесь завершения предыдущей генерации', 'busy');
    busy.add(id);
    let consumed = false;
    try {
        if (model.provider === 'giga') {
            const slot = await db.consumeGiga(id, model.key, model.limit);
            if (!slot.ok) throw new GenError(limitMessage(slot), 'limit');
            consumed = !slot.unlimited;
        }

        const result = await plugin.processRequest({
            prompt,
            fileBuffer: fileBuffer || null,
            fileBuffers: fileBuffers && fileBuffers.length > 1 ? fileBuffers : undefined,
            mimeType: mimeType || 'image/jpeg',
            modelKey: model.key,
            aspectRatio
        });

        const cost = Number.isFinite(Number(charge)) ? Math.max(0, Math.round(Number(charge))) : model.cost;
        const balance = await db.updateBalance(id, -cost, reason || `Генерация · ${model.name}`);
        await db.recordGeneration(id, cost);
        if (!keepModel) await db.setCurrentModel(id, model.key);
        consumed = false;

        return {
            type: result.type || 'text',
            text: result.text || '',
            buffer: result.buffer || null,
            cost,
            balance,
            model: model.key,
            modelName: model.name
        };
    } catch (e) {
        if (consumed) {
            try { await db.releaseGiga(id, model.key); } catch (err) {}
        }
        throw e;
    } finally {
        busy.delete(id);
    }
}

// Удобная обёртка для веба: data: URL вместо бинарника.
async function generateForWeb({ userId, prompt, modelKey, fileBuffer, mimeType, aspectRatio, charge, reason, keepModel, strict }) {
    const { model, plugin } = await prepare({
        userId,
        modelKey,
        hasImage: !!(fileBuffer && fileBuffer.length),
        hasText: !!(prompt && String(prompt).trim()),
        charge,
        strict
    });
    const out = await run({ userId, prompt, model, plugin, fileBuffer, mimeType, aspectRatio, charge, reason, keepModel });
    if (out.buffer) {
        const mime = out.type === 'audio' ? 'audio/mpeg' : out.type === 'video' ? 'video/mp4' : 'image/png';
        out.media = `data:${mime};base64,${out.buffer.toString('base64')}`;
    }
    delete out.buffer;
    return out;
}

module.exports = { prepare, run, generateForWeb, getPlugin, isBusy, GenError };
