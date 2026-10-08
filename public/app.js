const tg = window.Telegram.WebApp;
tg.expand(); // Развернуть на весь экран

const API_BASE = '/api';
let selectedRatio = '1:1';
let userProfile = null;

// Инициализация при запуске
document.addEventListener('DOMContentLoaded', async () => {
    initTelegramTheme();
    await loadProfile();
    await loadModels();
    await loadTemplates();

    // Настройка выбора соотношения сторон
    document.querySelectorAll('.ratio-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            selectedRatio = e.target.dataset.ratio;
        });
    });
});

function initTelegramTheme() {
    document.body.style.setProperty('--bg-color', tg.themeParams.bg_color || '#18222d');
    document.body.style.setProperty('--text-color', tg.themeParams.text_color || '#ffffff');
    document.body.style.setProperty('--button-color', tg.themeParams.button_color || '#2ea6ff');
}

// Запрос с передачей initData Telegram
async function apiRequest(endpoint, method = 'GET', body = null) {
    const headers = {
        'Content-Type': 'application/json',
        'x-telegram-init-data': tg.initData
    };
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(API_BASE + endpoint, options);
    return await res.json();
}

async function loadProfile() {
    const data = await apiRequest('/profile');
    if (data.user) {
        userProfile = data;
        document.getElementById('user-name').innerText = data.user.first_name;
        document.getElementById('user-balance').innerText = data.balance;
    }
}

async function loadModels() {
    const models = await apiRequest('/models');
    const select = document.getElementById('model-select');
    const list = document.getElementById('models-list');

    select.innerHTML = '';
    list.innerHTML = '';

    models.forEach(m => {
        // Опция в селект
        select.innerHTML += `<option value="${m.id}">${m.name} (${m.cost} кр.)</option>`;

        // Карточка в каталог моделей
        list.innerHTML += `
            <div class="model-card">
                <div>
                    <strong>${m.name}</strong>
                    <p>${m.desc}</p>
                </div>
                <div class="model-cost">${m.cost} кр.</div>
            </div>
        `;
    });
}

async function loadTemplates() {
    const templates = await apiRequest('/templates');
    const container = document.getElementById('templates-list');
    container.innerHTML = '';

    templates.forEach(t => {
        container.innerHTML += `
            <div class="template-card" onclick="useTemplate('${t.id}')">
                <h4>${t.title}</h4>
                <p class="template-pattern">${t.promptPattern}</p>
                <button class="btn-sm">Использовать</button>
            </div>
        `;
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    document.getElementById(`tab-${tabName}`).classList.add('active');
    event.target.classList.add('active');
}

function openCreateTemplateModal() {
    document.getElementById('template-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('template-modal').style.display = 'none';
}

async function saveTemplate() {
    const title = document.getElementById('tpl-title').value;
    const promptPattern = document.getElementById('tpl-pattern').value;
    const varsStr = document.getElementById('tpl-vars').value;
    const variables = varsStr.split(',').map(v => v.trim());

    if (!title || !promptPattern) {
        tg.showAlert('Заполните все поля!');
        return;
    }

    await apiRequest('/templates', 'POST', { title, promptPattern, variables });
    closeModal();
    tg.showAlert('Шаблон успешно сохранен!');
    loadTemplates();
}

async function handleGenerate(e) {
    e.preventDefault();
    const modelId = document.getElementById('model-select').value;
    const prompt = document.getElementById('prompt-input').value;

    if (!prompt) {
        tg.showAlert('Введите промпт!');
        return;
    }

    const btn = document.getElementById('btn-generate');
    btn.disabled = true;
    btn.innerText = 'Генерация...';

    const res = await apiRequest('/generate', 'POST', {
        modelId,
        prompt,
        aspectRatio: selectedRatio
    });

    btn.disabled = false;
    btn.innerText = 'Сгенерировать';

    if (res.success) {
        document.getElementById('generation-result').style.display = 'block';
        document.getElementById('result-content').innerHTML = `<p>🚀 ${res.message}. ID задачи: ${res.jobId}</p>`;
        loadProfile(); // Обновить баланс
    } else {
        tg.showAlert(res.error || 'Ошибка при генерации');
    }
}