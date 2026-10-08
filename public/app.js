const tg = window.Telegram.WebApp;
tg.expand();

let selectedRatio = '1:1';
let templatesCache = [];

document.addEventListener('DOMContentLoaded', async () => {
    await loadProfile();
    await loadModels();
    await loadTemplates();
});

async function api(path, method = 'GET', body = null) {
    const res = await fetch('/api' + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': tg.initData },
        body: body ? JSON.stringify(body) : null
    });
    return await res.json();
}

async function loadProfile() {
    const res = await api('/profile');
    if (res.user) {
        document.getElementById('user-name').innerText = res.user.first_name || 'Пользователь';
        document.getElementById('user-balance').innerText = res.balance;
    }
}

async function loadModels() {
    const models = await api('/models');
    const select = document.getElementById('model-select');
    const list = document.getElementById('models-list');
    select.innerHTML = ''; list.innerHTML = '';

    models.forEach(m => {
        select.innerHTML += `<option value="${m.id}">${m.name} (${m.cost} кр.)</option>`;
        list.innerHTML += `<div class="card"><strong>${m.name}</strong> (${m.cost} кр.)<p style="font-size:12px; opacity:0.7; margin:4px 0 0 0;">${m.desc}</p></div>`;
    });
}

async function loadTemplates() {
    templatesCache = await api('/templates');
    const list = document.getElementById('templates-list');
    list.innerHTML = '';

    templatesCache.forEach(t => {
        list.innerHTML += `
            <div class="card">
                <strong>${t.title}</strong>
                <p style="font-size:12px; opacity:0.7;">${t.promptPattern}</p>
                <button class="btn-primary" onclick="useTemplate('${t.id}')">Применить</button>
            </div>
        `;
    });
}

function useTemplate(id) {
    const tpl = templatesCache.find(t => t.id === id);
    if (!tpl) return;

    let p = tpl.promptPattern;
    if (tpl.variables) {
        tpl.variables.forEach(v => {
            const val = prompt(`Значение для {${v}}:`, 'котик');
            if (val) p = p.replace(new RegExp(`\\{${v}\\}`, 'g'), val);
        });
    }

    document.getElementById('prompt-input').value = p;
    switchTab('generate');
}

function switchTab(name, event) {
    document.querySelectorAll('.tab-content').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(e => e.classList.remove('active'));
    document.getElementById(`tab-${name}`).classList.add('active');
    if (event) event.target.classList.add('active');
}

function setRatio(r, event) {
    document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    selectedRatio = r;
}

function openModal() { document.getElementById('modal').style.display = 'flex'; }
function closeModal() { document.getElementById('modal').style.display = 'none'; }

async function saveTemplate() {
    const title = document.getElementById('tpl-title').value;
    const promptPattern = document.getElementById('tpl-pattern').value;
    const matches = promptPattern.match(/\{([^}]+)\}/g) || [];
    const variables = matches.map(m => m.replace(/[\{\}]/g, ''));

    await api('/templates', 'POST', { title, promptPattern, variables });
    closeModal();
    loadTemplates();
}

async function handleGenerate(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-submit');
    btn.disabled = true; btn.innerText = 'Генерация...';

    const res = await api('/generate', 'POST', {
        modelId: document.getElementById('model-select').value,
        prompt: document.getElementById('prompt-input').value,
        aspectRatio: selectedRatio
    });

    btn.disabled = false; btn.innerText = 'Сгенерировать';

    if (res.success) {
        document.getElementById('user-balance').innerText = res.newBalance;
        const box = document.getElementById('result-box');
        box.style.display = 'block';
        box.innerHTML = res.resultUrl.startsWith('http')
            ? `<img src="${res.resultUrl}" style="width:100%; border-radius:8px;" />`
            : `<p>${res.resultUrl}</p>`;
    } else {
        alert(res.error || 'Ошибка');
    }
}