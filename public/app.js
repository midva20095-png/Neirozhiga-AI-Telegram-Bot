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
    try {
        const res = await fetch('/api' + path, {
            method,
            headers: { 
                'Content-Type': 'application/json', 
                'x-telegram-init-data': tg.initData || '' 
            },
            body: body ? JSON.stringify(body) : null
        });
        return await res.json();
    } catch (err) {
        console.error('API Error:', err);
        return { error: 'Ошибка сети' };
    }
}

async function loadProfile() {
    const res = await api('/profile');
    if (res && res.user) {
        const nameEl = document.getElementById('user-name');
        const balanceEl = document.getElementById('user-balance');

        if (nameEl) nameEl.innerText = res.user.first_name || 'Пользователь';

        if (balanceEl) {
            let b = res.balance;
            if (typeof b === 'object' && b !== null) {
                b = b.balance ?? b.credits ?? 0;
            }
            balanceEl.innerText = b;
        }
    }
}

async function loadModels() {
    const models = await api('/models');
    if (!Array.isArray(models)) return;

    const select = document.getElementById('model-select');
    const list = document.getElementById('models-list');
    if (select) select.innerHTML = ''; 
    if (list) list.innerHTML = '';

    models.forEach(m => {
        if (select) select.innerHTML += `<option value="${m.id}">${m.name} (${m.cost} кр.)</option>`;
        if (list) list.innerHTML += `<div class="card"><strong>${m.name}</strong> (${m.cost} кр.)<p style="font-size:12px; opacity:0.7; margin:4px 0 0 0;">${m.desc}</p></div>`;
    });
}

async function loadTemplates() {
    const res = await api('/templates');
    templatesCache = Array.isArray(res) ? res : [];
    const list = document.getElementById('templates-list');
    if (!list) return;
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
    if (tpl.variables && tpl.variables.length > 0) {
        tpl.variables.forEach(v => {
            const val = prompt(`Значение для {${v}}:`, 'котик');
            if (val) p = p.replace(new RegExp(`\\{${v}\\}`, 'g'), val);
        });
    }

    const promptInput = document.getElementById('prompt-input');
    if (promptInput) promptInput.value = p;
    switchTab('generate');
}

function switchTab(name, event) {
    document.querySelectorAll('.tab-content').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(e => e.classList.remove('active'));

    const tabEl = document.getElementById(`tab-${name}`);
    if (tabEl) tabEl.classList.add('active');

    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        const btn = document.querySelector(`.tab-btn[onclick*="'${name}'"]`);
        if (btn) btn.classList.add('active');
    }
}

function setRatio(r, event) {
    document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    selectedRatio = r;
}

function openModal() { 
    const m = document.getElementById('modal');
    if (m) m.style.display = 'flex'; 
}

function closeModal() { 
    const m = document.getElementById('modal');
    if (m) m.style.display = 'none'; 
}

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
    if (e) e.preventDefault();
    const btn = document.getElementById('btn-submit');
    if (btn) { btn.disabled = true; btn.innerText = 'Генерация...'; }

    const res = await api('/generate', 'POST', {
        modelId: document.getElementById('model-select').value,
        prompt: document.getElementById('prompt-input').value,
        aspectRatio: selectedRatio
    });

    if (btn) { btn.disabled = false; btn.innerText = 'Сгенерировать'; }

    if (res && res.success) {
        const balanceEl = document.getElementById('user-balance');
        if (balanceEl) balanceEl.innerText = res.newBalance;

        const box = document.getElementById('result-box');
        if (box) {
            box.style.display = 'block';
            box.innerHTML = typeof res.resultUrl === 'string' && res.resultUrl.startsWith('http')
                ? `<img src="${res.resultUrl}" style="width:100%; border-radius:8px;" />`
                : `<p>${res.resultUrl}</p>`;
        }
    } else {
        alert((res && res.error) ? res.error : 'Ошибка генерации');
    }
}