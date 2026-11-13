const db = require('./db');
const catalog = require('./catalog');

let googlePlugin = null;
try { googlePlugin = require('../ai_plugins/google_gemini_plugin'); } catch (e) {}
let bratukhaPlugin = null;
try { bratukhaPlugin = require('../ai_plugins/bratukha_plugin'); } catch (e) {}
let gigaPlugin = null;
try { gigaPlugin = require('../ai_plugins/gigachat_plugin'); } catch (e) {}
let kiePlugin = null;
try { kiePlugin = require('../ai_plugins/kie_plugin'); } catch (e) {}

const PLUGINS = { google: googlePlugin, bratukha: bratukhaPlugin, giga: gigaPlugin, kie: kiePlugin };

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

const { userMessage, QUIET_ERROR } = require('./user_message');

// Общая проверка перед генерацией: возвращает подготовленные данные либо кидает GenError.
function limitMessage(slot) {
    if (slot.limit === 0) return 'Эта бесплатная модель сейчас без доступных генераций. Лимит можно изменить в админке.';
    return `Лимит бесплатной модели на сегодня исчерпан: ${slot.used}/${slot.limit}. Завтра по Москве счётчик обнулится.`;
}

async function prepare({ userId, modelKey, hasImage, hasText, charge, strict, duration, quality, audioSeconds }) {
    const id = String(userId);
    const user = await db.getUser(id);
    if (user.blocked) throw new GenError('Аккаунт в чёрном списке', 'blocked');

    let model = catalog.getModel(modelKey);
    if (!model && !strict) model = catalog.getModel(catalog.defaultModelKey());
    if (!model) throw new GenError('Модель недоступна', 'no_model');
    const plugin = getPlugin(model);
    if (!plugin || !plugin.processRequest) throw new GenError('Модель временно недоступна', 'no_plugin');

    if (model.image === 'required' && !hasImage) throw new GenError('Для этой модели нужно прикрепить изображение', 'need_image');
    if (model.image === 'forbidden' && hasImage) throw new GenError('Эта модель работает только по тексту, без фото', 'no_image');
    if (model.audio && !hasImage) throw new GenError('Для говорящего фото прикрепите фото и голосовое сообщение', 'need_image');
    if (model.audio && !(Number(audioSeconds) > 0)) throw new GenError('Пришлите голосовое сообщение вместе с фото. В кабинете бота это делается в чате.', 'need_audio');
    if (model.image !== 'required' && !model.audio && !hasText && !hasImage) throw new GenError('Введите текст запроса', 'need_text');

    if (model.provider === 'giga') {
        const lim = await db.peekGiga(id, model.key, model.limit);
        if (!lim.ok) throw new GenError(limitMessage(lim), 'limit');
    }

    const price = Number.isFinite(Number(charge))
        ? Math.max(0, Math.round(Number(charge)))
        : catalog.quote(model, { duration, quality, seconds: audioSeconds });
    if (Number(user.balance) < price) {
        throw new GenError(`Недостаточно кредитов: ${user.balance}, нужно ${price}`, 'no_credits');
    }

    return { user, model, plugin, price };
}

// Выполняет генерацию: держит замок, списывает кредиты и фиксирует статистику.
async function run({ userId, prompt, model, plugin, fileBuffer, fileBuffers, mimeType, aspectRatio, duration, quality, audioBuffer, audioMime, audioSeconds, charge, reason, keepModel }) {
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
            aspectRatio,
            duration,
            quality,
            audioBuffer: audioBuffer || null,
            audioMime: audioMime || 'audio/ogg',
            spec: model
        });

        const cost = Number.isFinite(Number(charge))
            ? Math.max(0, Math.round(Number(charge)))
            : catalog.quote(model, { duration, quality, seconds: audioSeconds });
        const balance = await db.updateBalance(id, -cost, reason || `Генерация · ${model.name}`);
        await db.recordGeneration(id, cost);
        if (!keepModel) await db.setCurrentModel(id, model.key);
        consumed = false;
        try {
            await db.saveWork(id, { kind: result.type, model: model.name, prompt, buffer: result.buffer });
            if (result.type === 'audio' && Array.isArray(result.extra)) {
                for (const buf of result.extra) {
                    await db.saveWork(id, { kind: 'audio', model: model.name, prompt, buffer: buf });
                }
            }
        } catch (err) {
            console.error('Не удалось сохранить работу:', err.message);
        }

        return {
            type: result.type || 'text',
            text: result.text || '',
            buffer: result.buffer || null,
            extra: result.extra || null,
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
async function generateForWeb({ userId, prompt, modelKey, fileBuffer, mimeType, aspectRatio, duration, quality, charge, reason, keepModel, strict }) {
    const { model, plugin } = await prepare({
        userId,
        modelKey,
        hasImage: !!(fileBuffer && fileBuffer.length),
        hasText: !!(prompt && String(prompt).trim()),
        charge,
        strict,
        duration,
        quality
    });
    const out = await run({ userId, prompt, model, plugin, fileBuffer, mimeType, aspectRatio, duration, quality, charge, reason, keepModel });
    const mime = out.type === 'audio' ? 'audio/mpeg' : out.type === 'video' ? 'video/mp4' : 'image/png';
    if (out.buffer) out.media = `data:${mime};base64,${out.buffer.toString('base64')}`;
    if (out.extra && out.extra.length && out.type === 'audio') {
        out.more = out.extra.filter(Boolean).map(buf => `data:${mime};base64,${buf.toString('base64')}`);
    }
    delete out.buffer;
    delete out.extra;
    return out;
}

module.exports = { prepare, run, generateForWeb, getPlugin, isBusy, GenError, userMessage, QUIET_ERROR };
