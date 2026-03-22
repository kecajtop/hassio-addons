document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById('racks-json');
    const select = document.getElementById('rack-preview-select');
    const canvas = document.getElementById('rack-preview-canvas');
    const meta = document.getElementById('rack-preview-meta');
    const itemsWrap = document.getElementById('rack-preview-items');

    if (!dataElement || !select || !canvas || !window.RackVisualizer) {
        return;
    }

    const racks = JSON.parse(dataElement.textContent || '[]');
    let selectedRackId = Number(select.value || (racks[0] && racks[0].id));
    let selectedToolId = null;

    function currentRack() {
        return racks.find((rack) => Number(rack.id) === Number(selectedRackId)) || racks[0];
    }

    function renderItems(rack) {
        itemsWrap.innerHTML = '';
        if (!rack || !(rack.items || []).length) {
            itemsWrap.innerHTML = '<div class="muted">Brak narzędzi na tym regale.</div>';
            return;
        }

        rack.items.forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `rack-item-chip${Number(item.id) === Number(selectedToolId) ? ' is-selected' : ''}`;
            button.textContent = `${item.name} · ${item.shelf}/${item.position}`;
            button.addEventListener('click', () => {
                selectedToolId = Number(item.id);
                draw();
            });
            itemsWrap.appendChild(button);
        });
    }

    function draw() {
        const rack = currentRack();
        if (!rack) {
            return;
        }

        meta.innerHTML = `
            <div><strong>${rack.name}</strong></div>
            <div class="muted">${rack.description || 'Bez opisu'}</div>
            <div class="muted small-text">Półki: ${rack.shelf_count} · Orientacja: ${rack.orientation || 'H'} · Narzędzia: ${(rack.items || []).length}</div>
        `;

        renderItems(rack);
        window.RackVisualizer.drawRack(canvas, rack, selectedToolId, { theme: 'light' });
    }

    select.addEventListener('change', () => {
        selectedRackId = Number(select.value);
        selectedToolId = null;
        draw();
    });

    draw();
});