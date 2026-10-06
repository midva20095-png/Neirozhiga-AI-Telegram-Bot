// Упаковываем картинки
    if (allBuffers.length > 0) {
        const rawBase64 = allBuffers[0].toString('base64');
        const dataUri = `data:${effectiveMimeType};base64,${rawBase64}`;
        
        // Передаем и чистый Base64, и Data URI во все возможные параметры
        inputData.image = dataUri;
        inputData.image_url = dataUri;
        inputData.init_image = dataUri;
        inputData.input_image = dataUri;

        // Некоторые инструменты ожидает чистый base64 без префикса data:image/...
        inputData.base64_image = rawBase64;
        inputData.bytes = rawBase64;
        
        console.log(`🖼️ [Bratukha Operations] Передано изображений: ${allBuffers.length} с промптом: "${finalPrompt}"`);
    }