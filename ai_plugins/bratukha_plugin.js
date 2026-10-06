const axios = require('axios');
const FormData = require('form-data');

const BRATUKHA_API_URL = 'https://bratuha.ru/api/v1';

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, modelKey }) {
    const apiKey = process.env.BRATUKHA_API_KEY;
    if (!apiKey) {
        throw new Error('❌ BRATUKHA_API_KEY не задан в переменных окружения');
    }

    let toolSlug = modelKey;
    if (!toolSlug) {
        throw new Error('❌ Не указан slug модели для Братухи');
    }

    const inputData = {};
    if (prompt) {
        inputData.prompt = prompt;
    }

    const allBuffers = [];
    if (fileBuffer) allBuffers.push(fileBuffer);
    if (fileBuffers && Array.isArray(fileBuffers)) {
        allBuffers.push(...fileBuffers);
    }

    // Загрузка файлов с расширенными параметрами (включая size)
    if (allBuffers.length > 0) {
        const uploadedUrls = [];
        for (const buf of allBuffers) {
            let fileUrl = null;
            let lastErr = null;
            const fileSize = buf.length;
            const fileMime = mimeType || 'image/jpeg';

            // 1. Попытка через /uploads/presign с передачей size и альтернативных полей
            try {
                console.log(`📤 [Загрузка Братухи] Запрос /uploads/presign (размер: ${fileSize} байт)...`);
                const presignRes = await axios.post(`${BRATUKHA_API_URL}/uploads/presign`, {
                    filename: 'input_file.jpg',
                    file_name: 'input_file.jpg',
                    size: fileSize,
                    content_type: fileMime,
                    mime_type: fileMime
                }, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });

                const { upload_url, url } = presignRes.data || {};
                if (upload_url && url) {
                    console.log(`📤 [Загрузка Братухи] Отправка файла по presigned URL...`);
                    await axios.put(upload_url, buf, {
                        headers: {
                            'Content-Type': fileMime
                        }
                    });
                    fileUrl = url;
                }
            } catch (err) {
                lastErr = err;
                console.warn(`⚠ [Загрузка Братухи] /uploads/presign не удался:`, err.response?.data ? JSON.stringify(err.response.data) : err.message);
            }

            // 2. Попытка через JSON с base64 на /uploads
            if (!fileUrl) {
                try {
                    console.log(`📤 [Загрузка Братухи] Отправка файла через JSON (base64)...`);
                    const uploadRes = await axios.post(`${BRATUKHA_API_URL}/uploads`, {
                        file: buf.toString('base64'),
                        data: buf.toString('base64'),
                        filename: 'input_file.jpg',
                        file_name: 'input_file.jpg',
                        size: fileSize,
                        content_type: fileMime,
                        mime_type: fileMime
                    }, {
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    fileUrl = uploadRes.data?.url || uploadRes.data?.file_url || uploadRes.data?.link || uploadRes.data?.path;
                } catch (err) {
                    lastErr = err;
                    console.warn(`⚠ [Загрузка Братухи] Загрузка JSON не удалась:`, err.response?.data ? JSON.stringify(err.response.data) : err.message);
                }
            }

            // 3. Попытка через FormData с перебором полей
            if (!fileUrl) {
                const possibleFields = ['file', 'files', 'image', 'media', 'attachment'];
                for (const fieldName of possibleFields) {
                    try {
                        const form = new FormData();
                        form.append(fieldName, buf, {
                            filename: 'input_file.jpg',
                            contentType: fileMime
                        });
                        form.append('size', String(fileSize));

                        const uploadRes = await axios.post(`${BRATUKHA_API_URL}/uploads`, form, {
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                ...form.getHeaders()
                            }
                        });
                        fileUrl = uploadRes.data?.url || uploadRes.data?.file_url || uploadRes.data?.link || uploadRes.data?.path;
                        if (fileUrl) break;
                    } catch (err) {
                        lastErr = err;
                    }
                }
            }

            if (fileUrl) {
                uploadedUrls.push(fileUrl);
                console.log(`✅ [Загрузка Братухи] Файл успешно загружен: ${fileUrl}`);
            } else {
                const errorDetails = lastErr?.response?.data ? JSON.stringify(lastErr.response.data) : lastErr?.message;
                console.error(`🚨 [Подробности об ошибке загрузки Братухи]:`, errorDetails);
                throw new Error(`Ошибка загрузки файла на сервере Братухи: ${errorDetails}`);
            }
        }

        if (uploadedUrls.length > 0) {
            inputData.image_url = uploadedUrls[0];
            inputData.images = uploadedUrls;
            inputData.file_url = uploadedUrls[0];
            inputData.files = uploadedUrls;
        }
    }

    // Создание операции через POST /api/v1/operations
    const payload = {
        tool: toolSlug,
        input: inputData
    };

    console.log(`🚀 [Bratukha Operations] Создание операции для инструмента: ${toolSlug}`);

    let createRes;
    try {
        createRes = await axios.post(`${BRATUKHA_API_URL}/operations`, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (err) {
        if (err.response) {
            const errData = err.response.data;
            console.error(`🚨 [Bratukha API Error] Status: ${err.response.status}`, JSON.stringify(errData));
            throw new Error(errData.error?.message || errData.message || `Ошибка API: статус ${err.response.status}`);
        }
        throw err;
    }

    const operationId = createRes.data?.id;
    if (!operationId) {
        throw new Error('❌ Не удалось получить ID операции от Братухи');
    }

    console.log(`⏳ [Bratukha] Операция создана. ID: ${operationId}. Статус: ${createRes.data.status}`);

    // Периодический опрос через GET /api/v1/operations/{id}
    const maxAttempts = 120;
    const intervalMs = 3000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));

        try {
            const statusRes = await axios.get(`${BRATUKHA_API_URL}/operations/${operationId}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            const opData = statusRes.data;
            console.log(`🔄 [Bratukha] Опрос [${operationId}]: статус — ${opData.status}`);

            if (opData.status === 'completed') {
                const result = opData.result;
                console.log(`✅ [Bratukha Success] Результат:`, JSON.stringify(result));

                const imageUrl = result?.images?.[0] || result?.urls?.[0] || result?.image_url || (result?.type === 'image' ? result?.url : null);
                const videoUrl = result?.videos?.[0] || result?.video_url || (result?.type === 'video' ? result?.url : null);
                
                if (imageUrl) {
                    const mediaRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                    return {
                        type: 'image',
                        buffer: Buffer.from(mediaRes.data),
                        text: result?.caption || '' 
                    };
                } else if (videoUrl) {
                    const mediaRes = await axios.get(videoUrl, { responseType: 'arraybuffer' });
                    return {
                        type: 'video',
                        buffer: Buffer.from(mediaRes.data),
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
                throw new Error(opData.error_message || 'Выполнение завершилось ошибкой на стороне нейросети');
            }
        } catch (pollErr) {
            if (pollErr.response?.status === 429 || pollErr.response?.status === 503) {
                const retryAfter = pollErr.response.headers['retry-after'] || 2;
                await new Promise(r => setTimeout(r, retryAfter * 1000));
                continue;
            }
            if (attempt === maxAttempts - 1) {
                throw pollErr;
            }
        }
    }

    throw new Error('⏱️ Превышено время ожидания ответа от нейросети (таймаут операции)');
}

module.exports = { processRequest };