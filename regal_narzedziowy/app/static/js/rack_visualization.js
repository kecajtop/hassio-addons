(function () {
    const DEFAULT_ROW_HEIGHT = 22;
    const DEFAULT_LIGHT_ROW_HEIGHT = 18;
    const DEFAULT_MIN_CANVAS_HEIGHT = 320;

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

    function useSwappedAxes(rack) {
        const vertical = String(rack?.orientation || 'H').toUpperCase() === 'V';
        const swapped = Number(rack?.swap_axes || 0) === 1;
        return vertical !== swapped;
    }

    function getRowHeight(options, canvas) {
        if (Number(options?.rowHeight) > 0) {
            return Number(options.rowHeight);
        }

        return canvas.width <= 500 ? DEFAULT_LIGHT_ROW_HEIGHT : DEFAULT_ROW_HEIGHT;
    }

    function getLayoutMetrics(canvas, rack, options) {
        const labels = parseShelfLabels(rack);
        const shelfCount = Math.max(labels.length, 1);
        const slots = getSlotCount(rack);
        const padding = 28;
        const titleHeight = 28;
        const rackX = padding;
        const rackY = padding + titleHeight;
        const transposed = useSwappedAxes(rack);
        const labelBandLeft = transposed ? 16 : 72;
        const labelBandTop = transposed ? 34 : 18;
        const rows = transposed ? slots : shelfCount;
        const rowHeight = getRowHeight(options, canvas);
        const gridHeight = rows * rowHeight;
        const rackHeight = labelBandTop + gridHeight + 8;
        const rackWidth = canvas.width - padding * 2;
        const gridX = rackX + labelBandLeft;
        const gridY = rackY + labelBandTop;
        const gridWidth = rackWidth - labelBandLeft - 8;
        const cols = transposed ? shelfCount : slots;
        const colWidth = gridWidth / cols;

        return {
            labels,
            shelfCount,
            slots,
            rackX,
            rackY,
            rackWidth,
            rackHeight,
            transposed,
            gridX,
            gridY,
            gridWidth,
            gridHeight,
            rows,
            cols,
            rowHeight,
            colWidth,
        };
    }

    function ensureCanvasHeight(canvas, rack, options) {
        const labels = parseShelfLabels(rack);
        const shelfCount = Math.max(labels.length, 1);
        const slots = getSlotCount(rack);
        const transposed = useSwappedAxes(rack);
        const rows = transposed ? slots : shelfCount;
        const rowHeight = getRowHeight(options, canvas);
        const padding = 28;
        const titleHeight = 28;
        const labelBandTop = transposed ? 34 : 18;
        const nextHeight = Math.max(
            DEFAULT_MIN_CANVAS_HEIGHT,
            Math.round((padding * 2) + titleHeight + labelBandTop + (rows * rowHeight) + 8),
        );

        if (canvas.height !== nextHeight) {
            canvas.height = nextHeight;
        }
    }

    function buildOccupiedSlots(rack, labels, selectedToolId) {
        const slots = new Map();

        (rack.items || []).forEach((item) => {
            const rawShelf = String(item.shelf ?? '').trim();
            const rawPosition = String(item.position ?? '').trim();
            const positionNumber = Number(rawPosition);
            if (!rawShelf || !rawPosition || Number.isNaN(positionNumber) || positionNumber < 1) {
                return;
            }

            const shelfLabel = normalizeShelf(item.shelf, labels);
            const position = Math.max(1, positionNumber);
            const size = Math.max(1, Math.round(Number(item.size) || 1));
            const archive = Number(item.archive || 0) === 1;
            const isSelected = Number(item.id) === Number(selectedToolId);

            for (let offset = 0; offset < size; offset += 1) {
                const slotPosition = position + offset;
                const key = `${shelfLabel}:${slotPosition}`;
                const existing = slots.get(key) || {
                    shelfLabel,
                    position: slotPosition,
                    items: [],
                    hasActive: false,
                    hasArchived: false,
                    isSelected: false,
                };

                existing.items.push(item);
                existing.hasActive = existing.hasActive || !archive;
                existing.hasArchived = existing.hasArchived || archive;
                existing.isSelected = existing.isSelected || isSelected;
                slots.set(key, existing);
            }
        });

        return slots;
    }

    function resolveSlotColors(slot, palette, hoveredSlotKey, slotKey) {
        const isHovered = hoveredSlotKey && hoveredSlotKey === slotKey;
        if (isHovered) {
            return {
                fill: palette.hover,
                stroke: palette.hoverBorder,
                text: palette.hoverText,
                glow: palette.hoverGlow,
            };
        }

        if (!slot) {
            return {
                fill: palette.empty,
                stroke: palette.emptyBorder,
                text: palette.emptyText,
            };
        }

        const itemCount = slot.items.length;
        if (slot.isSelected && itemCount > 1) {
            return {
                fill: palette.selectedMulti,
                stroke: palette.selectedMultiBorder,
                text: palette.selectedText,
                glow: palette.selectedMultiGlow,
            };
        }

        if (slot.isSelected) {
            return {
                fill: palette.selected,
                stroke: palette.selectedBorder,
                text: palette.selectedText,
                glow: palette.selectedGlow,
            };
        }

        if (itemCount > 1) {
            return {
                fill: palette.multi,
                stroke: palette.multiBorder,
                text: palette.multiText,
            };
        }

        if (slot.hasActive) {
            return {
                fill: palette.tool,
                stroke: palette.toolBorder,
                text: palette.toolText,
            };
        }

        return {
            fill: palette.archived,
            stroke: palette.archivedBorder,
            text: palette.archivedText,
        };
    }

    function getSlotKeyAtPoint(canvas, rack, pointX, pointY) {
        if (!canvas || !rack) {
            return null;
        }

        const layout = getLayoutMetrics(canvas, rack);
        if (
            pointX < layout.gridX ||
            pointY < layout.gridY ||
            pointX > layout.gridX + layout.gridWidth ||
            pointY > layout.gridY + layout.gridHeight
        ) {
            return null;
        }

        const colIndex = Math.min(layout.cols - 1, Math.max(0, Math.floor((pointX - layout.gridX) / layout.colWidth)));
        const rowIndex = Math.min(layout.rows - 1, Math.max(0, Math.floor((pointY - layout.gridY) / layout.rowHeight)));
        const shelfIndex = layout.transposed ? colIndex : rowIndex;
        const position = layout.transposed ? rowIndex + 1 : colIndex + 1;
        const shelfLabel = layout.labels[shelfIndex];

        return shelfLabel ? `${shelfLabel}:${position}` : null;
    }

    function drawRack(canvas, rack, selectedToolId, options) {
        if (!canvas || !rack) {
            return;
        }

        ensureCanvasHeight(canvas, rack, options);

        const ctx = canvas.getContext('2d');
        const theme = options?.theme === 'dark' ? 'dark' : 'light';
        const palette = theme === 'dark'
            ? {
                background: '#102030',
                border: '#7bc0df',
                shelf: '#335970',
                text: '#eef7fd',
                muted: '#bfd3e2',
                empty: '#f8fbfe',
                emptyBorder: '#7ea4bf',
                emptyText: '#557287',
                tool: '#c7dff0',
                toolBorder: '#6f96b2',
                toolText: '#153046',
                archived: '#f6eadc',
                archivedBorder: '#b7926f',
                archivedText: '#5f4428',
                hover: '#6cd29a',
                hoverBorder: '#258354',
                hoverText: '#0f3a26',
                hoverGlow: 'rgba(108, 210, 154, 0.30)',
                selected: '#ff5c2d',
                selectedBorder: '#bf3715',
                selectedText: '#ffffff',
                selectedGlow: 'rgba(255, 92, 45, 0.26)',
                multi: '#f4ab1c',
                multiBorder: '#bf7004',
                multiText: '#432700',
                selectedMulti: '#e22d78',
                selectedMultiBorder: '#9d124f',
                selectedMultiGlow: 'rgba(226, 45, 120, 0.24)',
            }
            : {
                background: '#eff8ff',
                border: '#2f7d9d',
                shelf: '#bad5e7',
                text: '#143047',
                muted: '#587288',
                empty: '#ffffff',
                emptyBorder: '#8fb0c9',
                emptyText: '#5b7689',
                tool: '#c8dff1',
                toolBorder: '#729ab7',
                toolText: '#143047',
                archived: '#f8ebde',
                archivedBorder: '#c39a77',
                archivedText: '#674929',
                hover: '#6ed39c',
                hoverBorder: '#2d925d',
                hoverText: '#103c28',
                hoverGlow: 'rgba(110, 211, 156, 0.24)',
                selected: '#ff5a2c',
                selectedBorder: '#c03d15',
                selectedText: '#ffffff',
                selectedGlow: 'rgba(255, 90, 44, 0.18)',
                multi: '#f6ad1f',
                multiBorder: '#c37407',
                multiText: '#4e2e00',
                selectedMulti: '#df2c77',
                selectedMultiBorder: '#9c1550',
                selectedMultiGlow: 'rgba(223, 44, 119, 0.18)',
            };

        const layout = getLayoutMetrics(canvas, rack, options);
        const occupiedSlots = buildOccupiedSlots(rack, layout.labels, selectedToolId);
        const hoveredSlotKey = options?.hoveredSlotKey || null;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = palette.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = palette.border;
        ctx.lineWidth = 2;
        ctx.strokeRect(layout.rackX, layout.rackY, layout.rackWidth, layout.rackHeight);

        ctx.fillStyle = palette.text;
        ctx.font = 'bold 18px Segoe UI';
        ctx.textAlign = 'center';
        ctx.fillText(`REGAŁ ${rack.name}`, canvas.width / 2, 24);

        ctx.font = '12px Segoe UI';
        ctx.strokeStyle = palette.shelf;
        ctx.lineWidth = 1;

        for (let rowIndex = 0; rowIndex <= layout.rows; rowIndex += 1) {
            const y = layout.gridY + rowIndex * layout.rowHeight;
            ctx.beginPath();
            ctx.moveTo(layout.gridX, y);
            ctx.lineTo(layout.gridX + layout.gridWidth, y);
            ctx.stroke();
        }

        for (let colIndex = 0; colIndex <= layout.cols; colIndex += 1) {
            const x = layout.gridX + colIndex * layout.colWidth;
            ctx.beginPath();
            ctx.moveTo(x, layout.gridY);
            ctx.lineTo(x, layout.gridY + layout.gridHeight);
            ctx.stroke();
        }

        layout.labels.forEach((label, shelfIndex) => {
            for (let position = 1; position <= layout.slots; position += 1) {
                const cellColIndex = layout.transposed ? shelfIndex : position - 1;
                const cellRowIndex = layout.transposed ? position - 1 : shelfIndex;
                const slotKey = `${label}:${position}`;
                const slot = occupiedSlots.get(slotKey);
                const colors = resolveSlotColors(slot, palette, hoveredSlotKey, slotKey);
                const cellX = layout.gridX + cellColIndex * layout.colWidth + 3;
                const cellY = layout.gridY + cellRowIndex * layout.rowHeight + 3;
                const cellWidth = Math.max(layout.colWidth - 6, 18);
                const cellHeight = Math.max(layout.rowHeight - 6, 18);

                if (colors.glow) {
                    ctx.fillStyle = colors.glow;
                    ctx.fillRect(cellX - 2, cellY - 2, cellWidth + 4, cellHeight + 4);
                }

                ctx.fillStyle = colors.fill;
                ctx.strokeStyle = colors.stroke;
                ctx.lineWidth = slot && slot.isSelected ? 2.4 : 1.2;
                ctx.fillRect(cellX, cellY, cellWidth, cellHeight);
                ctx.strokeRect(cellX, cellY, cellWidth, cellHeight);

                ctx.fillStyle = colors.text;
                ctx.font = slot && slot.items.length > 1 ? 'bold 11px Segoe UI' : 'bold 10px Segoe UI';
                ctx.textAlign = 'center';
                ctx.fillText(slot && slot.items.length > 1 ? `${position} (${slot.items.length})` : String(position), cellX + cellWidth / 2, cellY + cellHeight / 2 + 4);
            }
        });

        ctx.fillStyle = palette.muted;
        if (layout.transposed) {
            ctx.textAlign = 'center';
            layout.labels.forEach((label, index) => {
                const x = layout.gridX + index * layout.colWidth + layout.colWidth / 2;
                ctx.fillText(`Półka ${label}`, x, layout.rackY + 18);
            });
        } else {
            ctx.textAlign = 'left';
            layout.labels.forEach((label, index) => {
                const y = layout.gridY + index * layout.rowHeight + 16;
                ctx.fillText(`Półka ${label}`, layout.rackX + 6, y);
            });
        }

    }

    window.RackVisualizer = {
        drawRack,
        getSlotKeyAtPoint,
        parseShelfLabels,
        normalizeShelf,
    };
})();