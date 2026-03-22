class LightModeApp {
    constructor() {
        this.tools = [];
        this.racks = [];
        this.selectedTool = null;
        this.shiftEnabled = false;
        this.elements = {};
    }

    async init() {
        this.cacheElements();
        this.bindEvents();
        this.restoreTheme();
        await this.loadData();
        this.renderResults([]);
        this.drawEmpty();
    }

    cacheElements() {
        this.elements.input = document.getElementById('light-search-input');
        this.elements.searchBtn = document.getElementById('light-search-btn');
        this.elements.clearBtn = document.getElementById('light-clear-btn');
        this.elements.status = document.getElementById('light-search-status');
        this.elements.results = document.getElementById('light-search-results');
        this.elements.title = document.getElementById('light-rack-title');
        this.elements.subtitle = document.getElementById('light-rack-subtitle');
        this.elements.details = document.getElementById('light-tool-details');
        this.elements.canvas = document.getElementById('light-rack-canvas');
        this.elements.keyboard = document.getElementById('virtual-keyboard');
        this.elements.themeToggle = document.getElementById('theme-toggle');
    }

    bindEvents() {
        this.elements.searchBtn.addEventListener('click', () => this.performSearch());
        this.elements.clearBtn.addEventListener('click', () => this.clearSearch());
        this.elements.input.addEventListener('focus', () => this.showKeyboard());
        this.elements.input.addEventListener('click', () => this.showKeyboard());
        this.elements.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.performSearch();
            }
        });
        this.elements.themeToggle.addEventListener('click', () => this.toggleTheme());

        this.elements.keyboard.addEventListener('click', (event) => {
            const key = event.target.closest('.key');
            if (!key) {
                return;
            }

            if (key.dataset.action === 'close') {
                this.hideKeyboard();
                return;
            }

            const value = key.dataset.key;
            if (value === 'Shift') {
                this.shiftEnabled = !this.shiftEnabled;
                key.classList.toggle('is-active', this.shiftEnabled);
                return;
            }
            if (value === 'Backspace') {
                this.elements.input.value = this.elements.input.value.slice(0, -1);
                this.performSearch();
                return;
            }
            if (value === 'Enter') {
                this.performSearch();
                this.hideKeyboard();
                return;
            }

            const next = this.shiftEnabled ? value.toUpperCase() : value.toLowerCase();
            this.elements.input.value += next;
            if (this.shiftEnabled) {
                this.shiftEnabled = false;
                this.elements.keyboard.querySelectorAll('[data-key="Shift"]').forEach((button) => button.classList.remove('is-active'));
            }
            this.performSearch();
        });
    }

    async loadData() {
        const [toolsResponse, racksResponse] = await Promise.all([
            fetch('/api/light/tools'),
            fetch('/api/light/racks'),
        ]);

        const toolsPayload = await toolsResponse.json();
        this.tools = toolsPayload.tools || [];
        this.racks = await racksResponse.json();
        this.updateStatus('Gotowy do wyszukiwania');
    }

    performSearch() {
        const query = this.elements.input.value.trim();
        if (!query) {
            this.renderResults([]);
            this.drawEmpty();
            this.updateStatus('Wprowadź nazwę narzędzia w polu wyszukiwania');
            return;
        }

        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
        const regex = new RegExp(escaped, 'i');
        const matches = this.tools.filter((tool) => regex.test(tool.name) || regex.test(tool.description) || regex.test(tool.rack_name));
        this.renderResults(matches);
        this.updateStatus(matches.length ? `Znaleziono ${matches.length} narzędzi` : 'Brak wyników');
    }

    renderResults(results) {
        if (!results.length) {
            this.elements.results.innerHTML = '<div class="light-empty">Brak wyników do wyświetlenia.</div>';
            return;
        }

        this.elements.results.innerHTML = '';
        results.forEach((tool) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'light-result-card';
            button.innerHTML = `
                <strong>${tool.name}</strong>
                <span>Regał ${tool.rack_name || 'N/A'} · Półka ${tool.shelf || '-'} · Pozycja ${tool.position || '-'}</span>
                <small>${tool.description || 'Brak opisu'}</small>
            `;
            button.addEventListener('click', () => this.selectTool(tool));
            this.elements.results.appendChild(button);
        });
    }

    selectTool(tool) {
        this.selectedTool = tool;
        const rack = this.racks.find((item) => Number(item.id) === Number(tool.rack_id));
        this.elements.title.textContent = tool.name;
        this.elements.subtitle.textContent = `Regał ${tool.rack_name || 'N/A'} · Półka ${tool.shelf || '-'} · Pozycja ${tool.position || '-'}`;
        this.elements.details.innerHTML = `
            <div class="light-detail-row"><span>Opis</span><strong>${tool.description || 'Brak opisu'}</strong></div>
            <div class="light-detail-row"><span>Ilość</span><strong>${tool.qty || 0}</strong></div>
            <div class="light-detail-row"><span>Rozmiar</span><strong>${tool.size || 1}</strong></div>
        `;
        window.RackVisualizer.drawRack(this.elements.canvas, rack, tool.id, { theme: document.body.classList.contains('is-dark') ? 'dark' : 'light' });
    }

    drawEmpty() {
        const ctx = this.elements.canvas.getContext('2d');
        ctx.clearRect(0, 0, this.elements.canvas.width, this.elements.canvas.height);
        ctx.fillStyle = document.body.classList.contains('is-dark') ? '#111827' : '#ffffff';
        ctx.fillRect(0, 0, this.elements.canvas.width, this.elements.canvas.height);
        ctx.strokeStyle = document.body.classList.contains('is-dark') ? '#334155' : '#cbd5e1';
        ctx.strokeRect(16, 16, this.elements.canvas.width - 32, this.elements.canvas.height - 32);
        ctx.fillStyle = document.body.classList.contains('is-dark') ? '#cbd5e1' : '#64748b';
        ctx.font = '16px Segoe UI';
        ctx.textAlign = 'center';
        ctx.fillText('Wybierz narzędzie z listy, aby zobaczyć położenie na regale', this.elements.canvas.width / 2, this.elements.canvas.height / 2);
        this.elements.title.textContent = 'Wybierz narzędzie';
        this.elements.subtitle.textContent = 'Podgląd położenia na regale';
        this.elements.details.innerHTML = '';
    }

    clearSearch() {
        this.elements.input.value = '';
        this.selectedTool = null;
        this.renderResults([]);
        this.drawEmpty();
        this.updateStatus('Wprowadź nazwę narzędzia w polu wyszukiwania');
    }

    updateStatus(text) {
        this.elements.status.textContent = text;
    }

    showKeyboard() {
        this.elements.keyboard.classList.remove('is-hidden');
    }

    hideKeyboard() {
        this.elements.keyboard.classList.add('is-hidden');
    }

    restoreTheme() {
        const theme = localStorage.getItem('regal-light-theme');
        if (theme === 'dark') {
            document.body.classList.add('is-dark');
            this.elements?.themeToggle && (this.elements.themeToggle.textContent = '☀️');
        }
    }

    toggleTheme() {
        document.body.classList.toggle('is-dark');
        const dark = document.body.classList.contains('is-dark');
        this.elements.themeToggle.textContent = dark ? '☀️' : '🌙';
        localStorage.setItem('regal-light-theme', dark ? 'dark' : 'light');
        if (this.selectedTool) {
            this.selectTool(this.selectedTool);
        } else {
            this.drawEmpty();
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const app = new LightModeApp();
    await app.init();
    window.lightApp = app;
});