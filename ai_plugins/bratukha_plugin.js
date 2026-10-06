const BRATUKHA_API_URL = 'https://bratuha.ru/api/v1';

async function uploadBuffer(apiKey, buf, mimeType = 'image/jpeg', filename = 'input_file.jpg') {
    const contentType = mimeType || 'image/jpeg';
    const directLimit = 10 * 1024 * 1024; // прямой /uploads — до 10 МБ

    // Файл до 10 МБ: JSON с base64 в поле data
    if (buf.length <= directLimit) {
        const res = await fetch(`${BRATUKHA_API_URL}/uploads`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                filename,
                content_type: contentType,
                data: buf.toString('base64'),
            }),
            signal: AbortSignal.timeout(60_000),
        });

        const data = await res.json();
        if (!res.ok || !data?.url) {
            throw new Error(`В ответе /uploads нет url: ${JSON.stringify(data)}`);
        }

        return data.url;
    }

    // Больший файл: сначала получаем параметры presigned upload
    const presignRes = await fetch(`${BRATUKHA_API_URL}/uploads/presign`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            filename,
            content_type: contentType,
            size: buf.length,
        }),
        signal: AbortSignal.timeout(30_000),
    });

    const presignData = await presignRes.json();
    const { url, fields, publicUrl } = presignData || {};

    if (!presignRes.ok || !url || !fields || !publicUrl) {
        throw new Error(`Неполный ответ /uploads/presign: ${JSON.stringify(presignData)}`);
    }

    // Формируем multipart/form-data через встроенные FormData и Blob
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
        form.append(key, String(value));
    }

    const blob = new Blob([buf], { type: contentType });
    form.append('file', blob, filename);

    const uploadRes = await fetch(url, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
    });

    if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Ошибка загрузки на presigned URL: ${uploadRes.status} ${errText}`);
    }

    return publicUrl;
}

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, modelKey }) {
    const apiKey = process.env.BRATUKHA_API_KEY;
    if (!apiKey) {
        throw new Error('❌ BRATUKHA_API_KEY не задан в переменных окружения');
    }

    let toolSlug = modelKey;
    if (!toolSlug) {
        throw new Error('❌ Не указан slug модели для Братухи');
    }

    // Получаем схему инструмента для правильного сопоставления полей ввода
    let toolSchema = null;
    try {
        const schemaRes = await fetch(`${BRATUKHA_API_URL}/tools/${toolSlug}/schema`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(15_000),
        });
        if (schemaRes.ok) {
            toolSchema = await schemaRes.json();
        }
    } catch (e) {
        console.warn(`⚠ [Bratukha] Не удалось получить схему для инструмента ${toolSlug}:`, e.message);
    }

    const allBuffers = [];
    if (fileBuffer) allBuffers.push(fileBuffer);
    if (fileBuffers && Array.isArray(fileBuffers)) {
        allBuffers.push(...fileBuffers);
    }

    // Загрузка файлов
    const uploadedUrls = [];
    for (let i = 0; i < allBuffers.length; i++) {
        const url = await uploadBuffer(
            apiKey,
            allBuffers[i],
            mimeType || 'image/jpeg',
            `input_${i + 1}.jpg`
        );
        uploadedUrls.push(url);
    }

    // Формирование input данных строго под схему инструмента
    const inputData = {};
    if (prompt) {
        inputData.prompt = prompt;
    }

    if (uploadedUrls.length > 0) {
        let targetField = 'image_url';
        if (toolSchema && toolSchema.properties) {
            const keys = Object.keys(toolSchema.properties);
            const foundKey = keys.find(k => k === 'image_url' || k === 'images' || k === 'file_url' || k === 'files' || k.includes('image') || k.includes('file'));
            if (foundKey) targetField = foundKey;
        }

        const isArrayField = toolSchema?.properties?.[targetField]?.type === 'array' || Array.isArray(toolSchema?.properties?.[targetField]?.type);
        
        if (isArrayField) {
            inputData[targetField] = uploadedUrls;
        } else {
            inputData[targetField] = uploadedUrls.length === 1 ? uploadedUrls[0] : uploadedUrls;
        }
    }

    // Создание асинхронной операции через POST /api/v1/operations
    const payload = {
        tool: toolSlug,
        input: inputData
    };

    console.log(`🚀 [Bratukha Operations] Создание операции для инструмента: ${toolSlug}`);

    const createRes = await fetch(`${BRATUKHA_API_URL}/operations`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
        console.error(`🚨 [Bratukha API Error] Status: ${createRes.status}`, JSON.stringify(createData));
        throw new Error(createData.error?.message || createData.message || `Ошибка API: статус ${createRes.status}`);
    }

    const operationId = createData?.id;
    if (!operationId) {
        throw new Error('❌ Не удалось получить ID операции от Братухи');
    }

    console.log(`⏳ [Bratukha] Операция создана. ID: ${operationId}. Статус: ${createData.status}`);

    // Периодический опрос через GET /api/v1/operations/{id}
    const maxAttempts = 120;
    const intervalMs = 3000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));

        let statusRes;
        try {
            statusRes = await fetch(`${BRATUKHA_API_URL}/operations/${operationId}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                },
                signal: AbortSignal.timeout(15_000),
            });
        } catch (pollErr) {
            if (attempt === maxAttempts - 1) {
                throw pollErr;
            }
            continue;
        }

        if (statusRes.status === 429 || statusRes.status === 503) {
            const retryAfter = Number(statusRes.headers.get('retry-after') || 2);
            await new Promise(r => setTimeout(r, retryAfter * 1000));
            continue;
        }

        if (!statusRes.ok) {
            continue;
        }

        const opData = await statusRes.json();
        console.log(`🔄 [Bratukha] Опрос [${operationId}]: статус — ${opData.status}`);

        if (opData.status === 'completed') {
            const result = opData.result;
            console.log(`✅ [Bratukha Success] Результат:`, JSON.stringify(result));

            const imageUrl = result?.images?.[0] || result?.urls?.[0] || result?.image_url || (result?.type === 'image' ? result?.url : null);
            const videoUrl = result?.videos?.[0] || result?.video_url || (result?.type === 'video' ? result?.url : null);
            
            if (imageUrl) {
                const mediaRes = await fetch(imageUrl);
                const mediaBuf = Buffer.from(await mediaRes.arrayBuffer());
                return {
                    type: 'image',
                    buffer: mediaBuf,
                    text: result?.caption || '' 
                };
            } else if (videoUrl) {
                const mediaRes = await fetch(videoUrl);
                const mediaBuf = Buffer.from(await mediaRes.arrayBuffer());
                return {
                    type: 'video',
                    buffer: mediaBuf,
                    text: result?.caption || '' 
                };
            } else if (result && (result.text || typeof result === 'string')) {
                return {
                    type: 'text',
                    text: typeof result === 'string' ? result : result.text
                };
            } else {
                return {
                    type: 'text',
                    text: typeof result === 'object' ? (result.caption || JSON.stringify(result)) : String(result)
                };
            }
        } else if (opData.status === 'failed') {
            throw new Error(opData.error_message || opData.error?.message || 'Выполнение завершилось ошибкой на стороне нейросети');
        }
    }

    throw new Error('⏱️ Превышено время ожидания ответа от нейросети (таймаут операции)');
}

module.exports = { processRequest };