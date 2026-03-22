document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById('racks-json');
    const select = document.getElementById('rack-preview-select');
    const canvas = document.getElementById('rack-preview-canvas');
    const meta = document.getElementById('rack-preview-meta');
    const diagnostic = document.getElementById('rack-preview-diagnostic');
    const rackSearchInput = document.getElementById('rack-preview-rack-search-input');
    const rackSearchStatus = document.getElementById('rack-preview-rack-search-status');
    const searchInput = document.getElementById('rack-preview-search-input');
    const searchStatus = document.getElementById('rack-preview-search-status');
    const itemsWrap = document.getElementById('rack-preview-items');
    const contextMenu = document.getElementById('rack-context-menu');
    const contextMenuContent = document.getElementById('rack-context-menu-content');
    const imageModal = document.getElementById('rack-image-modal');
    const imageModalPreview = document.getElementById('rack-image-modal-preview');
    const detailsModal = document.getElementById('rack-details-modal');
    const detailsModalBody = document.getElementById('rack-details-modal-body');
    const moveModal = document.getElementById('rack-move-modal');
    const moveForm = document.getElementById('rack-move-form');
    const moveFormTool = document.getElementById('rack-move-form-tool');
    const moveRackId = document.getElementById('rack-move-rack-id');
    const moveShelf = document.getElementById('rack-move-shelf');
    const movePosition = document.getElementById('rack-move-position');

    if (!dataElement || !select || !canvas || !window.RackVisualizer) {
        return;
    }

    const racks = JSON.parse(dataElement.textContent || '[]');
    const toolCreateUrl = dataElement.dataset.toolCreateUrl || '';
    const toolEditTemplate = dataElement.dataset.toolEditTemplate || '';
    const toolDeleteTemplate = dataElement.dataset.toolDeleteTemplate || '';
    const toolMoveTemplate = dataElement.dataset.toolMoveTemplate || '';
    const canAddTools = dataElement.dataset.canAddTools === '1';
    const canEditTools = dataElement.dataset.canEditTools === '1';
    const canDeleteTools = dataElement.dataset.canDeleteTools === '1';
    const canMoveTools = dataElement.dataset.canMoveTools === '1';
    const cookiePrefix = 'rack_preview_';
    const preferredRack = racks.find((rack) => String(rack.name || '').toUpperCase() === 'R029');
    const savedRackId = Number(readCookie(`${cookiePrefix}rack_id`) || 0);
    const savedRackSearch = readCookie(`${cookiePrefix}rack_search`);
    const savedToolSearch = readCookie(`${cookiePrefix}tool_search`);
    let selectedRackId = resolveInitialRackId();
    let selectedToolId = null;
    let hoveredSlotKey = null;
    let pinnedSlotKey = null;
    let contextMenuState = null;

    if (rackSearchInput && savedRackSearch) {
        rackSearchInput.value = savedRackSearch;
    }

    if (searchInput && savedToolSearch) {
        searchInput.value = savedToolSearch;
    }

    updateRackOptions();

    function normalizeText(value) {
        return String(value || '').trim().toLowerCase();
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function readCookie(name) {
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

    function writeCookie(name, value) {
        document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
    }

    function resolveInitialRackId() {
        if (savedRackId && racks.some((rack) => Number(rack.id) === savedRackId)) {
            return savedRackId;
        }

        if (preferredRack) {
            return Number(preferredRack.id);
        }

        return Number((racks[0] && racks[0].id) || 0);
    }

    function clearCanvas() {
        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
    }

    function currentRackSearch() {
        return normalizeText(rackSearchInput ? rackSearchInput.value : '');
    }

    function currentToolSearch() {
        return normalizeText(searchInput ? searchInput.value : '');
    }

    function matchesRackSearch(rack, query) {
        if (!query) {
            return true;
        }

        const haystack = [
            rack.name,
            rack.description,
            rack.shelves,
            rack.orientation,
            rack.id,
        ].map(normalizeText).join(' ');

        return haystack.includes(query);
    }

    function filteredRacks() {
        const query = currentRackSearch();
        return racks.filter((rack) => matchesRackSearch(rack, query));
    }

    function updateRackOptions() {
        const visibleRacks = filteredRacks();
        const previousRackId = Number(selectedRackId);

        select.innerHTML = '';

        visibleRacks.forEach((rack) => {
            const option = document.createElement('option');
            option.value = String(rack.id);
            option.textContent = rack.name;
            select.appendChild(option);
        });

        if (rackSearchStatus) {
            const query = rackSearchInput ? rackSearchInput.value.trim() : '';
            rackSearchStatus.textContent = visibleRacks.length
                ? (query
                    ? `Znaleziono ${visibleRacks.length} ${visibleRacks.length === 1 ? 'regał' : 'regały'} dla: ${query}`
                    : `Dostępne regały: ${visibleRacks.length}.`)
                : `Brak regałów dla: ${query || 'podanego filtra'}`;
        }

        if (!visibleRacks.length) {
            selectedRackId = 0;
            select.disabled = true;
            return;
        }

        select.disabled = false;

        const nextRack = visibleRacks.find((rack) => Number(rack.id) === previousRackId)
            || visibleRacks.find((rack) => Number(rack.id) === Number(preferredRack && preferredRack.id))
            || visibleRacks[0];

        selectedRackId = Number(nextRack.id);
        select.value = String(nextRack.id);
        writeCookie(`${cookiePrefix}rack_id`, String(selectedRackId));
    }

    function formatLocation(item) {
        if (!hasAssignedLocation(item)) {
            return 'Nieprzypisane';
        }

        return `${item.shelf || '-'} / ${item.position || '-'}`;
    }

    function hasAssignedLocation(item) {
        const shelf = String(item?.shelf || '').trim();
        const rawPosition = String(item?.position || '').trim();
        const position = Number(rawPosition);
        return Boolean(shelf && rawPosition && !Number.isNaN(position) && position >= 1);
    }

    function unassignedItems(rack) {
        if (!rack) {
            return [];
        }

        return (rack.items || []).filter((item) => !hasAssignedLocation(item));
    }

    function activeSlotKey() {
        return hoveredSlotKey || pinnedSlotKey || null;
    }

    function activeSlotItems(rack) {
        const slotKey = activeSlotKey();
        if (!rack || !slotKey || !window.RackVisualizer) {
            return [];
        }

        const [rawShelf, rawPosition] = String(slotKey).split(':');
        const slotPosition = Number(rawPosition || 0);
        if (!rawShelf || !slotPosition) {
            return [];
        }

        const shelfLabels = window.RackVisualizer.parseShelfLabels(rack);
        const targetShelf = String(rawShelf).trim().toUpperCase();

        return (rack.items || []).filter((item) => {
            if (!hasAssignedLocation(item)) {
                return false;
            }

            const itemShelf = window.RackVisualizer.normalizeShelf(item.shelf, shelfLabels);
            const itemPosition = Math.max(1, Number(item.position) || 1);
            const itemSize = Math.max(1, Math.round(Number(item.size) || 1));
            return itemShelf === targetShelf && slotPosition >= itemPosition && slotPosition < itemPosition + itemSize;
        });
    }

    function matchesSearch(item, query) {
        if (!query) {
            return false;
        }

        const haystack = [
            item.name,
            item.description,
            item.id,
            item.shelf,
            item.position,
            `${item.shelf || ''}/${item.position || ''}`,
            `${item.shelf || ''}-${item.position || ''}`,
            `${item.name || ''} ${item.shelf || ''}/${item.position || ''}`,
        ].map(normalizeText).join(' ');

        return haystack.includes(query);
    }

    function matchedItemsForRack(rack) {
        if (!rack) {
            return [];
        }

        const query = currentToolSearch();
        if (!query) {
            return rack.items || [];
        }

        return (rack.items || []).filter((item) => matchesSearch(item, query));
    }

    function currentRack() {
        return racks.find((rack) => Number(rack.id) === Number(selectedRackId)) || null;
    }

    function currentSlotItems() {
        return activeSlotItems(currentRack());
    }

    function slotItemsByKey(rack, slotKey) {
        if (!rack || !slotKey || !window.RackVisualizer) {
            return [];
        }

        const [rawShelf, rawPosition] = String(slotKey).split(':');
        const slotPosition = Number(rawPosition || 0);
        if (!rawShelf || !slotPosition) {
            return [];
        }

        const shelfLabels = window.RackVisualizer.parseShelfLabels(rack);
        const targetShelf = String(rawShelf).trim().toUpperCase();
        return (rack.items || []).filter((item) => {
            if (!hasAssignedLocation(item)) {
                return false;
            }
            const itemShelf = window.RackVisualizer.normalizeShelf(item.shelf, shelfLabels);
            const itemPosition = Math.max(1, Number(item.position) || 1);
            const itemSize = Math.max(1, Math.round(Number(item.size) || 1));
            return itemShelf === targetShelf && slotPosition >= itemPosition && slotPosition < itemPosition + itemSize;
        });
    }

    function buildToolEditUrl(toolId) {
        return toolEditTemplate.replace('/0/', `/${toolId}/`);
    }

    function buildToolDeleteUrl(toolId) {
        return toolDeleteTemplate.replace('/0/', `/${toolId}/`);
    }

    function buildToolMoveUrl(toolId) {
        return toolMoveTemplate.replace('/0/', `/${toolId}/`);
    }

    function buildToolCreateUrl(slotKey) {
        const url = new URL(toolCreateUrl, window.location.origin);
        const rack = currentRack();
        if (rack) {
            url.searchParams.set('rack_id', String(rack.id));
        }
        if (slotKey) {
            const [shelf, position] = String(slotKey).split(':');
            if (shelf) {
                url.searchParams.set('shelf', shelf);
            }
            if (position) {
                url.searchParams.set('position', position);
            }
        }
        return `${url.pathname}${url.search}`;
    }

    function openImageModal(tool) {
        if (!imageModal || !imageModalPreview || !tool || !tool.image_url) {
            return;
        }
        imageModalPreview.src = tool.image_url;
        imageModalPreview.alt = `Zdjęcie narzędzia ${tool.name}`;
        imageModal.classList.remove('is-hidden');
        imageModal.setAttribute('aria-hidden', 'false');
    }

    function closeImageModal() {
        if (!imageModal || !imageModalPreview) {
            return;
        }
        imageModal.classList.add('is-hidden');
        imageModal.setAttribute('aria-hidden', 'true');
        imageModalPreview.src = '';
    }

    function openDetailsModal(tool) {
        if (!detailsModal || !detailsModalBody || !tool) {
            return;
        }
        detailsModalBody.innerHTML = `
            <div class="rack-details-grid">
                <div class="rack-details-visual">
                    ${tool.image_url ? `<img class="rack-details-image" src="${escapeHtml(tool.image_url)}" alt="Zdjęcie ${escapeHtml(tool.name)}">` : '<div class="rack-details-image rack-details-image-empty">Brak zdjęcia</div>'}
                </div>
                <div class="rack-details-info">
                    <div class="rack-detail-row"><span>Nazwa</span><strong>${escapeHtml(tool.name)}</strong></div>
                    <div class="rack-detail-row"><span>Lokalizacja</span><strong>${escapeHtml(formatLocation(tool))}</strong></div>
                    <div class="rack-detail-row"><span>Ilość</span><strong>${escapeHtml(tool.qty || 0)}</strong></div>
                    <div class="rack-detail-row"><span>Rozmiar</span><strong>${escapeHtml(tool.size || 1)}</strong></div>
                    <div class="rack-detail-row"><span>LED</span><strong>${escapeHtml(tool.led_count || 0)} / ${escapeHtml(tool.led_space || 0)}</strong></div>
                    <div class="rack-detail-row"><span>Archiwum</span><strong>${Number(tool.archive) ? 'Tak' : 'Nie'}</strong></div>
                    <div class="rack-detail-row rack-detail-row-description"><span>Opis</span><strong>${escapeHtml(tool.description || 'Brak opisu')}</strong></div>
                    ${tool.link ? `<div class="rack-detail-row"><span>Link</span><strong><a href="${escapeHtml(tool.link)}" target="_blank" rel="noreferrer">Otwórz</a></strong></div>` : ''}
                    ${tool.stl ? `<div class="rack-detail-row"><span>STL</span><strong>${escapeHtml(tool.stl)}</strong></div>` : ''}
                </div>
            </div>
        `;
        detailsModal.classList.remove('is-hidden');
        detailsModal.setAttribute('aria-hidden', 'false');
    }

    function closeDetailsModal() {
        if (!detailsModal || !detailsModalBody) {
            return;
        }
        detailsModal.classList.add('is-hidden');
        detailsModal.setAttribute('aria-hidden', 'true');
        detailsModalBody.innerHTML = '';
    }

    function openMoveModal(tool, slotKey) {
        if (!moveModal || !moveForm || !moveRackId || !moveShelf || !movePosition || !tool) {
            return;
        }

        moveForm.action = buildToolMoveUrl(tool.id);
        moveFormTool.textContent = `Przenoszenie: ${tool.name}`;
        moveRackId.value = String((currentRack() && currentRack().id) || tool.rack_id || '');

        if (slotKey) {
            const [shelf, position] = String(slotKey).split(':');
            moveShelf.value = shelf || tool.shelf || '';
            movePosition.value = position || tool.position || '';
        } else {
            moveShelf.value = tool.shelf || '';
            movePosition.value = tool.position || '';
        }

        moveModal.classList.remove('is-hidden');
        moveModal.setAttribute('aria-hidden', 'false');
    }

    function closeMoveModal() {
        if (!moveModal || !moveForm) {
            return;
        }
        moveModal.classList.add('is-hidden');
        moveModal.setAttribute('aria-hidden', 'true');
        moveForm.action = '';
    }

    function hideContextMenu() {
        if (!contextMenu || !contextMenuContent) {
            return;
        }
        contextMenu.classList.add('is-hidden');
        contextMenu.setAttribute('aria-hidden', 'true');
        contextMenuContent.innerHTML = '';
        contextMenuState = null;
    }

    function submitDelete(tool) {
        if (!tool || !canDeleteTools) {
            return;
        }
        if (!window.confirm(`Usunąć narzędzie ${tool.name}?`)) {
            return;
        }
        const form = document.createElement('form');
        form.method = 'post';
        form.action = buildToolDeleteUrl(tool.id);
        document.body.appendChild(form);
        form.submit();
    }

    function makeActionButton(label, action, tone) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `rack-context-action${tone ? ` is-${tone}` : ''}`;
        button.textContent = label;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            hideContextMenu();
            action();
        });
        return button;
    }

    function buildToolActionSection(tool, slotKey) {
        const section = document.createElement('section');
        section.className = 'rack-context-section';

        const title = document.createElement('div');
        title.className = 'rack-context-section-title';
        title.textContent = tool.name;
        section.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'rack-context-actions';
        actions.appendChild(makeActionButton('Szczegóły', () => openDetailsModal(tool)));
        if (tool.image_url) {
            actions.appendChild(makeActionButton('Podgląd zdjęcia', () => openImageModal(tool)));
        }
        if (canEditTools) {
            actions.appendChild(makeActionButton('Edytuj', () => { window.location.href = buildToolEditUrl(tool.id); }));
        }
        if (canMoveTools) {
            actions.appendChild(makeActionButton('Przenieś', () => openMoveModal(tool, slotKey)));
        }
        if (canDeleteTools) {
            actions.appendChild(makeActionButton('Usuń', () => submitDelete(tool), 'danger'));
        }
        section.appendChild(actions);
        return section;
    }

    function showContextMenu(event, builder) {
        if (!contextMenu || !contextMenuContent) {
            return;
        }
        event.preventDefault();
        contextMenuContent.innerHTML = '';
        builder(contextMenuContent);

        if (!contextMenuContent.childElementCount) {
            hideContextMenu();
            return;
        }

        contextMenu.classList.remove('is-hidden');
        contextMenu.setAttribute('aria-hidden', 'false');
        const menuWidth = 320;
        const menuHeight = 420;
        const left = Math.min(window.innerWidth - menuWidth - 12, Math.max(12, event.clientX));
        const top = Math.min(window.innerHeight - menuHeight - 12, Math.max(12, event.clientY));
        contextMenu.style.left = `${left}px`;
        contextMenu.style.top = `${top}px`;
        contextMenuState = { left, top };
    }

    function showToolContextMenu(event, tool, slotKey = null) {
        showContextMenu(event, (container) => {
            container.appendChild(buildToolActionSection(tool, slotKey));
        });
    }

    function showSlotContextMenu(event, slotKey) {
        const rack = currentRack();
        const slotItems = slotItemsByKey(rack, slotKey);

        showContextMenu(event, (container) => {
            const title = document.createElement('div');
            title.className = 'rack-context-menu-title';
            title.textContent = slotKey ? `Pole ${slotKey.replace(':', ' / ')}` : 'Poza polem';
            container.appendChild(title);

            if (canAddTools && slotKey) {
                const addSection = document.createElement('section');
                addSection.className = 'rack-context-section';
                const actions = document.createElement('div');
                actions.className = 'rack-context-actions';
                actions.appendChild(makeActionButton('Dodaj narzędzie do pola', () => {
                    window.location.href = buildToolCreateUrl(slotKey);
                }, 'primary'));
                addSection.appendChild(actions);
                container.appendChild(addSection);
            }

            if (slotItems.length) {
                slotItems.forEach((tool) => {
                    container.appendChild(buildToolActionSection(tool, slotKey));
                });
                return;
            }

            const empty = document.createElement('div');
            empty.className = 'rack-context-empty';
            empty.textContent = slotKey ? 'To pole jest puste.' : 'Kliknij prawym przyciskiem bezpośrednio na pole regału.';
            container.appendChild(empty);
        });
    }

    function setDiagnostic(message, tone) {
        if (!diagnostic) {
            return;
        }

        if (!message) {
            diagnostic.textContent = '';
            diagnostic.className = 'rack-preview-diagnostic is-hidden';
            return;
        }

        diagnostic.textContent = message;
        diagnostic.className = `rack-preview-diagnostic is-${tone || 'success'}`;
    }

    function renderItems(rack) {
        if (!itemsWrap) {
            return;
        }

        itemsWrap.innerHTML = '';
        if (!rack || !(rack.items || []).length) {
            if (searchStatus) {
                searchStatus.textContent = 'Brak narzędzi na tym regale.';
            }
            itemsWrap.innerHTML = '<div class="muted">Brak narzędzi na tym regale.</div>';
            return;
        }

        const slotKey = activeSlotKey();
        const slotItems = activeSlotItems(rack);
        const missingLocationItems = unassignedItems(rack);
        const query = currentToolSearch();

        if (slotItems.length) {
            const slotLabel = slotKey.replace(':', ' / ');
            const modeLabel = hoveredSlotKey ? 'Podgląd pola' : 'Wybrane pole';
            searchStatus.textContent = `${modeLabel} ${slotLabel} zawiera ${slotItems.length} ${slotItems.length === 1 ? 'narzędzie' : 'narzędzia'}. Kliknij inne pole, aby zmienić podgląd.`;

            slotItems.forEach((item) => {
                itemsWrap.appendChild(buildResultButton(item, `is-hover-preview${!hoveredSlotKey ? ' is-slot-pinned' : ''}`));
            });

            if (missingLocationItems.length) {
                itemsWrap.appendChild(buildUnassignedBlock(missingLocationItems));
            }
            return;
        }

        if (!query) {
            if (missingLocationItems.length) {
                searchStatus.textContent = `Regał ${rack.name} zawiera ${rack.items.length} narzędzi, w tym ${missingLocationItems.length} bez przypisanego pola.`;
                itemsWrap.appendChild(buildUnassignedBlock(missingLocationItems));
                return;
            }

            searchStatus.textContent = `Regał ${rack.name} zawiera ${rack.items.length} narzędzi. Zacznij pisać albo kliknij pole na podglądzie regału.`;
            itemsWrap.innerHTML = '<div class="muted">To miejsce pokazuje wyniki wyszukiwania albo zawartość klikniętego pola regału.</div>';
            return;
        }

        const matchedItems = matchedItemsForRack(rack);
        const matchedAssignedItems = matchedItems.filter((item) => hasAssignedLocation(item));
        const matchedUnassignedItems = matchedItems.filter((item) => !hasAssignedLocation(item));

        searchStatus.textContent = matchedItems.length
            ? `Znaleziono ${matchedItems.length} ${matchedItems.length === 1 ? 'wynik' : 'wyniki'} dla: ${searchInput.value.trim()}`
            : `Brak wyników dla: ${searchInput.value.trim()}`;

        if (!matchedItems.length) {
            itemsWrap.innerHTML = '<div class="muted">Nie znaleziono narzędzi pasujących do zapytania.</div>';
            return;
        }

        matchedAssignedItems.forEach((item) => {
            itemsWrap.appendChild(buildResultButton(item));
        });

        if (matchedUnassignedItems.length) {
            itemsWrap.appendChild(buildUnassignedBlock(matchedUnassignedItems));
        }
    }

    function buildUnassignedBlock(items) {
        const wrap = document.createElement('section');
        wrap.className = 'rack-unassigned-block';

        const title = document.createElement('div');
        title.className = 'rack-unassigned-title';
        title.textContent = `Nieprzypisane (${items.length})`;
        wrap.appendChild(title);

        items.forEach((item) => {
            wrap.appendChild(buildResultButton(item, 'is-unassigned'));
        });

        return wrap;
    }

    function buildResultButton(item, extraClasses = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `rack-search-result ${extraClasses}`.trim() + `${Number(item.id) === Number(selectedToolId) ? ' is-selected' : ''}`;
        button.innerHTML = `
            <strong>${item.name}</strong>
            <span>Lokalizacja: ${formatLocation(item)}</span>
            <small>${item.description || 'Brak opisu'}</small>
        `;
        button.addEventListener('click', () => {
            selectedToolId = Number(item.id);
            if (!hasAssignedLocation(item)) {
                hoveredSlotKey = null;
                pinnedSlotKey = null;
            }
            draw();
        });
        button.addEventListener('contextmenu', (event) => {
            showToolContextMenu(event, item, hasAssignedLocation(item) ? `${item.shelf}:${item.position}` : null);
        });
        return button;
    }

    function syncSelectedTool(rack) {
        if (!rack) {
            selectedToolId = null;
            return;
        }

        const query = currentToolSearch();
        const availableItems = rack.items || [];

        if (!query) {
            if (!availableItems.some((item) => Number(item.id) === Number(selectedToolId))) {
                selectedToolId = null;
            }
            return;
        }

        const matchedItems = matchedItemsForRack(rack);
        if (matchedItems.some((item) => Number(item.id) === Number(selectedToolId))) {
            return;
        }

        selectedToolId = matchedItems.length === 1 ? Number(matchedItems[0].id) : null;
    }

    function draw() {
        const rack = currentRack();
        if (!rack) {
            clearCanvas();
            meta.innerHTML = '<div><strong>Brak pasującego regału</strong></div><div class="muted">Zmień filtr wyszukiwania regałów, aby zobaczyć podgląd.</div>';
            if (itemsWrap) {
                itemsWrap.innerHTML = '<div class="muted">Brak wyników dla bieżącego filtra regałów.</div>';
            }
            if (searchStatus) {
                searchStatus.textContent = 'Najpierw wybierz regał, aby wyszukać narzędzie.';
            }
            setDiagnostic('Nie znaleziono danych dla wybranego regału.', 'error');
            return;
        }

        syncSelectedTool(rack);
        writeCookie(`${cookiePrefix}rack_id`, String(rack.id));
        writeCookie(`${cookiePrefix}rack_search`, rackSearchInput ? rackSearchInput.value.trim() : '');
        writeCookie(`${cookiePrefix}tool_search`, searchInput ? searchInput.value.trim() : '');

        meta.innerHTML = `
            <div><strong>${rack.name}</strong></div>
            <div class="muted">${rack.description || 'Bez opisu'}</div>
            <div class="muted small-text">Półki: ${rack.shelf_count} · Orientacja: ${rack.orientation || 'H'} · Zamiana osi: ${Number(rack.swap_axes) ? 'tak' : 'nie'} · Narzędzia: ${(rack.items || []).length} · Nieprzypisane: ${unassignedItems(rack).length}</div>
        `;

        renderItems(rack);
        try {
            window.RackVisualizer.drawRack(canvas, rack, selectedToolId, { theme: 'light', hoveredSlotKey: activeSlotKey() });
            setDiagnostic(`Podgląd regału ${rack.name} został wyrenderowany. Półki: ${rack.shelf_count}, narzędzia: ${(rack.items || []).length}, orientacja: ${rack.orientation || 'H'}, zamiana osi: ${Number(rack.swap_axes) ? 'tak' : 'nie'}.`, 'success');
        } catch (error) {
            setDiagnostic(`Nie udało się narysować regału ${rack.name}. ${error.message || error}`, 'error');
        }
    }

    select.addEventListener('change', () => {
        selectedRackId = Number(select.value);
        selectedToolId = null;
        hoveredSlotKey = null;
        pinnedSlotKey = null;
        draw();
    });

    if (rackSearchInput) {
        rackSearchInput.addEventListener('input', () => {
            const previousRackId = selectedRackId;
            updateRackOptions();
            if (Number(previousRackId) !== Number(selectedRackId)) {
                selectedToolId = null;
                hoveredSlotKey = null;
                pinnedSlotKey = null;
            }
            draw();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            draw();
        });
    }

    canvas.addEventListener('mousemove', (event) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const slotKey = window.RackVisualizer.getSlotKeyAtPoint(
            canvas,
            currentRack(),
            (event.clientX - rect.left) * scaleX,
            (event.clientY - rect.top) * scaleY,
        );

        if (slotKey !== hoveredSlotKey) {
            hoveredSlotKey = slotKey;
            draw();
        }
    });

    canvas.addEventListener('click', (event) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const slotKey = window.RackVisualizer.getSlotKeyAtPoint(
            canvas,
            currentRack(),
            (event.clientX - rect.left) * scaleX,
            (event.clientY - rect.top) * scaleY,
        );

        pinnedSlotKey = slotKey;
        hoveredSlotKey = slotKey;
        selectedToolId = null;
        hideContextMenu();
        draw();
    });

    canvas.addEventListener('contextmenu', (event) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const slotKey = window.RackVisualizer.getSlotKeyAtPoint(
            canvas,
            currentRack(),
            (event.clientX - rect.left) * scaleX,
            (event.clientY - rect.top) * scaleY,
        );

        pinnedSlotKey = slotKey;
        hoveredSlotKey = slotKey;
        selectedToolId = null;
        draw();
        showSlotContextMenu(event, slotKey);
    });

    canvas.addEventListener('mouseleave', () => {
        if (!hoveredSlotKey) {
            return;
        }

        hoveredSlotKey = null;
        draw();
    });

    document.addEventListener('click', (event) => {
        if (contextMenu && !contextMenu.classList.contains('is-hidden') && !contextMenu.contains(event.target)) {
            hideContextMenu();
        }
    });

    document.addEventListener('scroll', hideContextMenu, true);
    window.addEventListener('resize', hideContextMenu);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideContextMenu();
            closeImageModal();
            closeDetailsModal();
            closeMoveModal();
        }
    });

    document.querySelectorAll('[data-close-rack-image-modal="true"]').forEach((element) => {
        element.addEventListener('click', closeImageModal);
    });
    document.querySelectorAll('[data-close-rack-details-modal="true"]').forEach((element) => {
        element.addEventListener('click', closeDetailsModal);
    });
    document.querySelectorAll('[data-close-rack-move-modal="true"]').forEach((element) => {
        element.addEventListener('click', closeMoveModal);
    });

    draw();
});