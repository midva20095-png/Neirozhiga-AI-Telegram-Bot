const fs = require('fs');
const path = require('path');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const templates = require('./templates');

function loadAdminTopics(rows) {
    const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
    const start = html.indexOf('const TOPIC_GROUPS = ');
    const end = html.indexOf('function fileToJpeg');
    assert.ok(start > 0 && end > start);
    const nodes = {};
    function make(id) {
        return {
            id,
            value: '',
            innerHTML: '',
            querySelectorAll() {
                const found = [];
                const re = /data-addtopic="([^"]*)"/g;
                let match;
                while ((match = re.exec(this.innerHTML))) {
                    found.push({
                        dataset: {
                            addtopic: match[1]
                                .replace(/&quot;/g, '"')
                                .replace(/&amp;/g, '&')
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                        }
                    });
                }
                return found;
            }
        };
    }
    const context = {
        document: {
            getElementById(id) {
                if (!nodes[id]) nodes[id] = make(id);
                return nodes[id];
            }
        },
        templates: rows || [],
        esc(value) {
            return String(value == null ? '' : value).replace(/[&<>"]/g, char => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
            }[char]));
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${html.slice(start, end)}\nthis.api = { TOPIC_GROUPS, presetTopics, paintTopics, toggleTopic, addTopic, topicCatalog, selectedTopics };`,
        context
    );
    context.nodes = nodes;
    return context;
}

function buttonNames(html) {
    return [...html.matchAll(/data-addtopic="([^"]*)"/g)].map(match => match[1]);
}

test('готовые категории админки доходят до кабинета целиком', () => {
    const admin = loadAdminTopics();
    const names = Array.from(admin.api.presetTopics());
    assert.ok(names.length >= 30);
    assert.equal(new Set(names.map(name => name.toLowerCase())).size, names.length);
    names.forEach(name => {
        assert.ok(name.length <= 40);
        assert.equal(/[,;|]/.test(name), false);
    });
    assert.ok(names.includes('Кондитер'));
    assert.deepEqual(templates.topicList(names.join(', ')), names);
    const item = templates.fromDb({
        id: 1,
        title: 'Торт',
        prompt: 'секрет',
        model: 'nano-banana',
        cost: 6,
        active: true,
        category: 'image',
        topics: 'Кондитер, Портрет'
    });
    assert.deepEqual(item.cats, ['Кондитер', 'Портрет']);
    assert.deepEqual(templates.toPublic(item).cats, ['Кондитер', 'Портрет']);
});

test('в форме шаблона можно выбрать готовую категорию и свою', () => {
    const admin = loadAdminTopics([{ topics: 'Авторское, кондитер' }]);
    admin.document.getElementById('ttopics');
    admin.document.getElementById('tnewtopic');
    admin.document.getElementById('topiclist');
    admin.api.paintTopics();
    const first = buttonNames(admin.nodes.topiclist.innerHTML);
    assert.deepEqual(first.filter(name => name === 'Кондитер' || name === 'Портрет' || name === 'Авторское'), ['Портрет', 'Кондитер', 'Авторское']);
    assert.match(admin.nodes.topiclist.innerHTML, /Кондитер/);
    assert.match(admin.nodes.topiclist.innerHTML, />Свои</);
    admin.api.toggleTopic('Портрет');
    assert.equal(admin.nodes.ttopics.value, 'Портрет');
    assert.match(admin.nodes.topiclist.innerHTML, /data-addtopic="Портрет" class="on"|class="on"[^>]*data-addtopic="Портрет"/);
    admin.api.toggleTopic('Кондитер');
    assert.equal(admin.nodes.ttopics.value, 'Портрет, Кондитер');
    admin.api.toggleTopic('Портрет');
    assert.equal(admin.nodes.ttopics.value, 'Кондитер');
    admin.nodes.tnewtopic.value = 'Витрина';
    admin.api.addTopic();
    assert.equal(admin.nodes.ttopics.value, 'Кондитер, Витрина');
    assert.equal(admin.nodes.tnewtopic.value, '');
    assert.ok(buttonNames(admin.nodes.topiclist.innerHTML).includes('Витрина'));
    const catalog = admin.api.topicCatalog();
    assert.match(catalog, /Кондитер · 1/);
    assert.match(catalog, /Портрет · 0/);
    assert.match(catalog, /Авторское · 1/);
});
