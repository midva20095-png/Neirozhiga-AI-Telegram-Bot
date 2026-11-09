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
async function prepare({ userId, modelKey, hasImage, hasText }) {
    const id = String(userId);
    const user = await db.getUser(id);
    if (user.blocked) throw new GenError('Аккаунт в чёрном списке', 'blocked');

    const model = catalog.getModel(modelKey) || catalog.getModel(catalog.defaultModelKey());
    if (!model) throw new GenError('Модель недоступна', 'no_model');
    const plugin = getPlugin(model);
    if (!plugin || !plugin.processRequest) throw new GenError('Модель временно недоступна', 'no_plugin');

    if (model.image === 'required' && !hasImage) throw new GenError('Для этой модели нужно прикрепить изображение', 'need_image');
    if (model.image !== 'required' && !hasText && !hasImage) throw new GenError('Введите текст запроса', 'need_text');
    if (model.image === 'required' && model.group !== 'fix' && !hasText) {
        // видео/анимация: фото обязательно, промпт тоже полезен, но не блокируем при наличии фото
    }

    let gigaInfo = null;
    if (model.provider === 'giga' && model.limit !== undefined) {
        const lim = await db.checkGigaLimit(id, model.key);
        if (!lim.ok) throw new GenError(`Лимит бесплатной модели на сегодня исчерпан: ${lim.used}/${lim.limit}. Завтра счётчик обнулится.`, 'limit');
        gigaInfo = lim;
    }

    if (Number(user.balance) < model.cost) {
        throw new GenError(`Недостаточно кредитов: ${user.balance}, нужно ${model.cost}`, 'no_credits');
    }

    return { user, model, plugin, gigaInfo };
}

// Выполняет генерацию: держит замок, списывает кредиты и фиксирует статистику.
async function run({ userId, prompt, model, plugin, fileBuffer, fileBuffers, mimeType, aspectRatio }) {
    const id = String(userId);
    if (busy.has(id)) throw new GenError('Дождитесь завершения предыдущей генерации', 'busy');
    busy.add(id);
    try {
        const result = await plugin.processRequest({
            prompt,
            fileBuffer: fileBuffer || null,
            fileBuffers: fileBuffers && fileBuffers.length > 1 ? fileBuffers : undefined,
            mimeType: mimeType || 'image/jpeg',
            modelKey: model.key,
            aspectRatio
        });

        const balance = await db.updateBalance(id, -model.cost, `Генерация · ${model.name}`);
        await db.recordGeneration(id, model.cost);
        await db.setCurrentModel(id, model.key);
        if (model.provider === 'giga' && model.limit !== undefined) await db.addGigaUse(id, model.key);

        return {
            type: result.type || 'text',
            text: result.text || '',
            buffer: result.buffer || null,
            cost: model.cost,
            balance,
            model: model.key,
            modelName: model.name
        };
    } finally {
        busy.delete(id);
    }
}

// Удобная обёртка для веба: data: URL вместо бинарника.
async function generateForWeb({ userId, prompt, modelKey }) {
    const { model, plugin } = await prepare({
        userId,
        modelKey,
        hasImage: false,
        hasText: !!(prompt && prompt.trim())
    });
    const out = await run({ userId, prompt, model, plugin });
    if (out.buffer) {
        const mime = out.type === 'audio' ? 'audio/mpeg' : out.type === 'video' ? 'video/mp4' : 'image/png';
        out.media = `data:${mime};base64,${out.buffer.toString('base64')}`;
    }
    delete out.buffer;
    return out;
}

module.exports = { prepare, run, generateForWeb, getPlugin, isBusy, GenError };
