(function () {
    function parseShelfLabels(rack) {
        const raw = String(rack?.shelves || '').trim();
        if (!raw) {
            const count = Number(rack?.shelf_count || 0);
            return Array.from({ length: count || 1 }, (_, index) => String.fromCharCode(65 + index));
        }

        const parts = raw.split(',').map((value) => value.trim()).filter(Boolean);
        if (parts.length === 1 && /^\d+$/.test(parts[0])) {
            const count = Number(parts[0]);
            return Array.from({ length: count || 1 }, (_, index) => String.fromCharCode(65 + index));
        }
        return parts;
    }

    function normalizeShelf(value, labels) {
        const raw = String(value ?? '').trim();
        if (!raw) {
            return labels[0] || 'A';
        }
        if (/^[A-Za-z]$/.test(raw)) {
            return raw.toUpperCase();
        }
        const numeric = Number(raw);
        if (!Number.isNaN(numeric)) {
            if (numeric === 0) {
                return labels[0] || 'A';
            }
            return labels[Math.max(0, numeric - 1)] || String.fromCharCode(64 + numeric);
        }
        return raw.toUpperCase();
    }

    function getSlotCount(rack) {
        const positions = (rack.items || []).map((item) => Number(item.position) || 1);
        const maxPosition = positions.length ? Math.max(...positions) : 10;
        return Math.max(10, maxPosition);
    }

    function drawRack(canvas, rack, selectedToolId, options) {
        if (!canvas || !rack) {
            return;
        }

        const ctx = canvas.getContext('2d');
        const theme = options?.theme === 'dark' ? 'dark' : 'light';
        const palette = theme === 'dark'
            ? {
                background: '#1e293b',
                border: '#cbd5e1',
                shelf: '#475569',
                text: '#e2e8f0',
                muted: '#94a3b8',
                tool: '#38bdf8',
                toolAlt: '#0ea5e9',
                selected: '#f97316',
                selectedGlow: 'rgba(249, 115, 22, 0.24)',
            }
            : {
                background: '#ffffff',
                border: '#334155',
                shelf: '#cbd5e1',
                text: '#0f172a',
                muted: '#64748b',
                tool: '#60a5fa',
                toolAlt: '#2563eb',
                selected: '#f97316',
                selectedGlow: 'rgba(249, 115, 22, 0.18)',
            };

        const labels = parseShelfLabels(rack);
        const shelfCount = Math.max(labels.length, 1);
        const slots = getSlotCount(rack);
        const padding = 28;
        const titleHeight = 28;
        const rackX = padding;
        const rackY = padding + titleHeight;
        const rackWidth = canvas.width - padding * 2;
        const rackHeight = canvas.height - padding * 2 - titleHeight;
        const shelfHeight = rackHeight / shelfCount;
        const slotWidth = rackWidth / slots;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = palette.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = palette.border;
        ctx.lineWidth = 2;
        ctx.strokeRect(rackX, rackY, rackWidth, rackHeight);

        ctx.fillStyle = palette.text;
        ctx.font = 'bold 18px Segoe UI';
        ctx.textAlign = 'center';
        ctx.fillText(`REGAŁ ${rack.name}`, canvas.width / 2, 24);

        ctx.font = '12px Segoe UI';
        labels.forEach((label, index) => {
            const y = rackY + index * shelfHeight;
            ctx.strokeStyle = palette.shelf;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(rackX, y);
            ctx.lineTo(rackX + rackWidth, y);
            ctx.stroke();

            ctx.fillStyle = palette.muted;
            ctx.textAlign = 'left';
            ctx.fillText(`Półka ${label}`, rackX + 6, y + 15);
        });

        ctx.beginPath();
        ctx.moveTo(rackX, rackY + rackHeight);
        ctx.lineTo(rackX + rackWidth, rackY + rackHeight);
        ctx.stroke();

        (rack.items || []).forEach((item) => {
            const shelfLabel = normalizeShelf(item.shelf, labels);
            const shelfIndex = Math.max(0, labels.indexOf(shelfLabel));
            const position = Math.max(1, Number(item.position) || 1);
            const size = Math.max(1, Number(item.size) || 1);
            const rectX = rackX + (position - 1) * slotWidth + 4;
            const rectY = rackY + shelfIndex * shelfHeight + 22;
            const rectWidth = Math.max(slotWidth * size - 8, 20);
            const rectHeight = Math.max(shelfHeight - 32, 22);
            const isSelected = Number(item.id) === Number(selectedToolId);

            if (isSelected) {
                ctx.fillStyle = palette.selectedGlow;
                ctx.fillRect(rectX - 4, rectY - 4, rectWidth + 8, rectHeight + 8);
            }

            ctx.fillStyle = isSelected ? palette.selected : palette.tool;
            ctx.strokeStyle = isSelected ? palette.selected : palette.toolAlt;
            ctx.lineWidth = isSelected ? 2.5 : 1.5;
            ctx.fillRect(rectX, rectY, rectWidth, rectHeight);
            ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px Segoe UI';
            ctx.textAlign = 'center';
            ctx.fillText(String(item.position || ''), rectX + rectWidth / 2, rectY + rectHeight / 2 + 4);
        });
    }

    window.RackVisualizer = {
        drawRack,
        parseShelfLabels,
        normalizeShelf,
    };
})();