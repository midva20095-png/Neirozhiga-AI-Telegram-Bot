const videoFileRef = generatedVideo.video;
            const fileUri = typeof videoFileRef === 'string' ? videoFileRef : (videoFileRef.uri || videoFileRef.name);

            // Вытаскиваем чистое имя файла (например, files/1o99clsqj1rz) из любой ссылки
            let fileName = fileUri;
            const match = fileUri.match(/(files\/[a-zA-Z0-9_-]+)/);
            if (match) {
                fileName = match[1];
            }

            console.log(`📥 Скачивание файла через SDK Google: ${fileName}`);
            const downloadedFile = await ai.files.download({ name: fileName });
            
            let videoBuffer = null;
            if (Buffer.isBuffer(downloadedFile)) {
                videoBuffer = downloadedFile;
            } else if (downloadedFile && downloadedFile.data) {
                videoBuffer = Buffer.from(downloadedFile.data);
            } else if (downloadedFile) {
                videoBuffer = Buffer.from(downloadedFile);
            }

            if (!videoBuffer || videoBuffer.length === 0) {
                throw new Error('Не удалось загрузить бинарные данные сгенерированного видео');
            }

            return {
                type: 'video',
                buffer: videoBuffer,
                text: safePrompt || '🎬 Видео успешно создано с помощью Veo!'
            };