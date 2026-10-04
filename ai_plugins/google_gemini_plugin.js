import { GoogleGenAI } from "@google/genai";

export class GoogleGeminiImagePlugin {
    constructor(apiKey) {
        // Инициализация официального клиента @google/genai
        this.ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY });
    }

    /**
     * Универсальный метод генерации и редактирования изображений (Nano Banana / Gemini 3)
     * @param {Object} options 
     * @param {string} options.model - Модель ('gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image')
     * @param {string|Array} options.input - Текст запроса или массив частей (текст, картинки, видео)
     * @param {string} [options.aspectRatio] - Соотношение сторон ("1:1", "16:9", "5:4", "4:1", "1:4", "8:1", "1:8")
     * @param {string} [options.imageSize] - Размер изображения: "512px", "1K", "2K", "4K" (обязательно с заглавной 'K')
     * @param {string} [options.mimeType] - MIME-тип ("image/jpeg", "image/png")
     * @param {Array} [options.tools] - Инструменты (например, [{ type: "google_search" }])
     * @param {string} [options.thinkingLevel] - Уровень размышлений ("minimal", "high")
     * @param {string} [options.previousInteractionId] - ID предыдущего взаимодействия для многошагового редактирования
     */
    async generateImage(options) {
        const {
            model = "gemini-3.1-flash-image",
            input,
            aspectRatio = "1:1",
            imageSize = "1K",
            mimeType = "image/png",
            tools,
            thinkingLevel,
            previousInteractionId
        } = options;

        const config = {};

        // Настройка формата вывода изображения
        if (aspectRatio || imageSize || mimeType) {
            config.responseFormat = {
                type: "image",
                mimeType: mimeType,
                aspectRatio: aspectRatio,
                imageSize: imageSize
            };
        }

        // Настройка уровня мышления (для Gemini 3.1 Flash / Flash Lite / Pro)
        if (thinkingLevel) {
            config.generationConfig = {
                thinkingLevel: thinkingLevel
            };
        }

        if (tools) {
            config.tools = tools;
        }

        if (previousInteractionId) {
            config.previousInteractionId = previousInteractionId;
        }

        try {
            const interaction = await this.ai.interactions.create({
                model: model,
                input: input,
                ...config
            });

            let imageBuffer = null;
            let textOutput = interaction.output_text || "";
            let steps = interaction.steps || [];

            // Проверяем прямое свойство output_image
            if (interaction.output_image && interaction.output_image.data) {
                imageBuffer = Buffer.from(interaction.output_image.data, 'base64');
            } else {
                // Если вывод содержит чередующиеся блоки или сложную структуру
                for (const step of steps) {
                    if (step.type === "model_output" && step.content) {
                        for (const block of step.content) {
                            if (block.type === "image" && block.data) {
                                imageBuffer = Buffer.from(block.data, 'base64');
                            }
                            if (block.type === "text" && block.text) {
                                textOutput += "\n" + block.text;
                            }
                        }
                    }
                }
            }

            if (!imageBuffer) {
                throw new Error("Интерфейс Google не вернул данные изображения в ответе.");
            }

            return {
                success: true,
                imageBuffer,
                textOutput,
                interactionId: interaction.id,
                steps
            };

        } catch (error) {
            console.error("Ошибка при генерации изображения через Nano Banana API:", error);
            return {
                success: false,
                error: error.message || error
            };
        }
    }
}