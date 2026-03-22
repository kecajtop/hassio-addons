class LightModeApp {
    constructor() {
        this.tools = [];
        this.racks = [];
        this.selectedTool = null;
        this.hoveredSlotKey = null;
        this.shiftEnabled = false;
        this.cookiePrefix = 'light_preview_';
        this.elements = {};
    }

    async init() {
        this.cacheElements();
        this.bindEvents();
        this.restoreTheme();
        await this.loadData();
        this.restoreState();
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
        this.elements.canvas.addEventListener('mousemove', (event) => this.handleCanvasHover(event));
        this.elements.canvas.addEventListener('mouseleave', () => this.clearCanvasHover());

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

    readCookie(name) {
        const encodedName = `${name}=`;
        const parts = document.cookie.split(';');
        for (const part of parts) {
            const cookie = part.trim();
            if (cookie.startsWith(encodedName)) {
                return decodeURIComponent(cookie.slice(encodedName.length));
            }
        }
        return '';
    }

    writeCookie(name, value) {
        document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
    }

    clearCookie(name) {
        document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
    }

    restoreState() {
        const savedQuery = this.readCookie(`${this.cookiePrefix}query`);
        const savedToolId = Number(this.readCookie(`${this.cookiePrefix}tool_id`) || 0);

        if (savedQuery) {
            this.elements.input.value = savedQuery;
            this.performSearch();
        } else {
            this.renderResults([]);
            this.drawEmpty();
        }

        if (savedToolId) {
            const savedTool = this.tools.find((tool) => Number(tool.id) === savedToolId);
            if (savedTool) {
                this.selectTool(savedTool, { persist: false, ensureVisible: !savedQuery });
            }
        }
    }

    persistSearchQuery(query) {
        if (query) {
            this.writeCookie(`${this.cookiePrefix}query`, query);
            return;
        }
        this.clearCookie(`${this.cookiePrefix}query`);
    }

    persistSelectedTool(tool) {
        if (tool && tool.id) {
            this.writeCookie(`${this.cookiePrefix}tool_id`, String(tool.id));
            this.writeCookie(`${this.cookiePrefix}rack_id`, String(tool.rack_id || ''));
            return;
        }

        this.clearCookie(`${this.cookiePrefix}tool_id`);
        this.clearCookie(`${this.cookiePrefix}rack_id`);
    }

    performSearch() {
        const query = this.elements.input.value.trim();
        this.persistSearchQuery(query);

        if (!query) {
            this.renderResults([]);
            this.drawEmpty();
            this.persistSelectedTool(null);
            this.updateStatus('Wprowadź nazwę narzędzia w polu wyszukiwania');
            return;
        }

        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
        const regex = new RegExp(escaped, 'i');
        const matches = this.tools.filter((tool) => regex.test(tool.name) || regex.test(tool.description) || regex.test(tool.rack_name));
        this.renderResults(matches);

        if (!matches.some((tool) => Number(tool.id) === Number(this.selectedTool && this.selectedTool.id))) {
            this.selectedTool = null;
            this.hoveredSlotKey = null;
            this.persistSelectedTool(null);
            if (matches.length === 1) {
                this.selectTool(matches[0]);
                return;
            }
            this.drawEmpty();
        }

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
            button.className = `light-result-card${Number(tool.id) === Number(this.selectedTool && this.selectedTool.id) ? ' is-selected' : ''}`;
            button.innerHTML = `
                <strong>${tool.name}</strong>
                <span>Regał ${tool.rack_name || 'N/A'} · Półka ${tool.shelf || '-'} · Pozycja ${tool.position || '-'}</span>
                <small>${tool.description || 'Brak opisu'}</small>
            `;
            button.addEventListener('click', () => this.selectTool(tool));
            this.elements.results.appendChild(button);
        });
    }

    selectTool(tool, options = {}) {
        const { persist = true, ensureVisible = false } = options;
        this.selectedTool = tool;
        const rack = this.racks.find((item) => Number(item.id) === Number(tool.rack_id));
        if (!rack) {
            this.drawEmpty();
            return;
        }

        if (ensureVisible) {
            this.elements.input.value = tool.name || '';
            this.persistSearchQuery(this.elements.input.value.trim());
            this.renderResults([tool]);
        } else {
            this.renderResults(this.getCurrentResults());
        }

        this.elements.title.textContent = tool.name;
        this.elements.subtitle.textContent = `Regał ${tool.rack_name || 'N/A'} · Półka ${tool.shelf || '-'} · Pozycja ${tool.position || '-'}`;
        this.elements.details.innerHTML = `
            <div class="light-detail-row"><span>Opis</span><strong>${tool.description || 'Brak opisu'}</strong></div>
            <div class="light-detail-row"><span>Ilość</span><strong>${tool.qty || 0}</strong></div>
            <div class="light-detail-row"><span>Rozmiar</span><strong>${tool.size || 1}</strong></div>
        `;
        window.RackVisualizer.drawRack(this.elements.canvas, rack, tool.id, {
            theme: document.body.classList.contains('is-dark') ? 'dark' : 'light',
            hoveredSlotKey: this.hoveredSlotKey,
        });
        this.updateStatus(`Wybrano narzędzie ${tool.name} na regale ${tool.rack_name || 'N/A'}.`);

        if (persist) {
            this.persistSelectedTool(tool);
        }
    }

    getCurrentResults() {
        const query = this.elements.input.value.trim();
        if (!query) {
            return [];
        }

        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
        const regex = new RegExp(escaped, 'i');
        return this.tools.filter((tool) => regex.test(tool.name) || regex.test(tool.description) || regex.test(tool.rack_name));
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
        this.hoveredSlotKey = null;
        this.persistSearchQuery('');
        this.persistSelectedTool(null);
        this.renderResults([]);
        this.drawEmpty();
        this.updateStatus('Wprowadź nazwę narzędzia w polu wyszukiwania');
    }

    handleCanvasHover(event) {
        if (!this.selectedTool) {
            return;
        }

        const rack = this.racks.find((item) => Number(item.id) === Number(this.selectedTool.rack_id));
        if (!rack) {
            return;
        }

        const rect = this.elements.canvas.getBoundingClientRect();
        const scaleX = this.elements.canvas.width / rect.width;
        const scaleY = this.elements.canvas.height / rect.height;
        const slotKey = window.RackVisualizer.getSlotKeyAtPoint(
            this.elements.canvas,
            rack,
            (event.clientX - rect.left) * scaleX,
            (event.clientY - rect.top) * scaleY,
        );

        if (slotKey !== this.hoveredSlotKey) {
            this.hoveredSlotKey = slotKey;
            this.selectTool(this.selectedTool);
        }
    }

    clearCanvasHover() {
        if (!this.hoveredSlotKey) {
            return;
        }

        this.hoveredSlotKey = null;
        if (this.selectedTool) {
            this.selectTool(this.selectedTool);
        }
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
        const theme = this.readCookie(`${this.cookiePrefix}theme`) || localStorage.getItem('regal-light-theme');
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
        this.writeCookie(`${this.cookiePrefix}theme`, dark ? 'dark' : 'light');
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