document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('suggestions-form');
    const fileInput = document.getElementById('suggestion-attachments-input');
    const pastedInput = document.getElementById('suggestion-pasted-attachments');
    const pasteZone = document.getElementById('suggestion-paste-zone');
    const preview = document.getElementById('suggestion-attachments-preview');
    const status = document.getElementById('suggestion-attachments-status');
    const contentField = form ? form.querySelector('textarea[name="content"]') : null;

    if (!form || !fileInput || !pastedInput || !pasteZone || !preview || !status) {
        return;
    }

    const uploadFiles = [];
    const pastedFiles = [];

    function fileKey(file) {
        return [file.name, file.size, file.lastModified, file.type].join('::');
    }

    function isImage(file) {
        return String(file.type || '').toLowerCase().startsWith('image/');
    }

    function syncUploadFiles() {
        const transfer = new DataTransfer();
        uploadFiles.forEach((file) => transfer.items.add(file));
        fileInput.files = transfer.files;
    }

    function syncPastedFiles() {
        pastedInput.value = JSON.stringify(pastedFiles.map((entry) => entry.payload));
    }

    function allFileKeys() {
        const keys = new Set(uploadFiles.map((file) => fileKey(file)));
        pastedFiles.forEach((entry) => keys.add(entry.key));
        return keys;
    }

    function attachmentCount() {
        return uploadFiles.length + pastedFiles.length;
    }

    function updateStatus() {
        const totalFiles = attachmentCount();

        if (!totalFiles) {
            status.textContent = 'Możesz dodać wiele plików. Załączniki zostaną zapisane bezpośrednio w bazie danych zakupy1.';
            preview.classList.add('is-hidden');
            preview.innerHTML = '';
            return;
        }

        status.textContent = `Dodano ${totalFiles} ${totalFiles === 1 ? 'załącznik' : 'załączniki'}. Wklejone obrazy zostaną wysłane razem z formularzem i zapisane w bazie danych.`;
        preview.classList.remove('is-hidden');
        preview.innerHTML = '';

        const entries = [
            ...uploadFiles.map((file, index) => ({ file, index, source: 'upload' })),
            ...pastedFiles.map((entry, index) => ({ file: entry.file, index, source: 'pasted' })),
        ];

        entries.forEach(({ file, index, source }) => {
            const card = document.createElement('div');
            card.className = 'suggestion-attachment-card';

            const meta = document.createElement('div');
            meta.className = 'suggestion-attachment-meta';

            if (isImage(file)) {
                const image = document.createElement('img');
                image.className = 'suggestion-attachment-thumb';
                image.alt = file.name;
                image.src = URL.createObjectURL(file);
                image.addEventListener('load', () => {
                    URL.revokeObjectURL(image.src);
                }, { once: true });
                meta.appendChild(image);
            }

            const textWrap = document.createElement('div');
            textWrap.className = 'suggestion-attachment-text';
            textWrap.innerHTML = `
                <strong>${file.name}</strong>
                <span>${Math.max(1, Math.round(file.size / 1024))} KB${isImage(file) ? ' · obraz' : ''}</span>
            `;
            meta.appendChild(textWrap);

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'ghost-button ghost-button-danger';
            removeButton.textContent = 'Usuń';
            removeButton.addEventListener('click', () => {
                if (source === 'upload') {
                    uploadFiles.splice(index, 1);
                    syncUploadFiles();
                } else {
                    pastedFiles.splice(index, 1);
                    syncPastedFiles();
                }
                updateStatus();
            });

            card.appendChild(meta);
            card.appendChild(removeButton);
            preview.appendChild(card);
        });
    }

    function addUploadFiles(files) {
        const existingKeys = allFileKeys();
        Array.from(files || []).forEach((file) => {
            const key = fileKey(file);
            if (existingKeys.has(key)) {
                return;
            }
            existingKeys.add(key);
            uploadFiles.push(file);
        });
        syncUploadFiles();
        updateStatus();
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Nie udało się odczytać pliku.'));
            reader.readAsDataURL(file);
        });
    }

    async function addPastedFiles(files) {
        const existingKeys = allFileKeys();

        for (const file of Array.from(files || [])) {
            const key = fileKey(file);
            if (existingKeys.has(key)) {
                continue;
            }

            const dataUrl = await readFileAsDataUrl(file);
            const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
            if (!base64Data) {
                continue;
            }

            existingKeys.add(key);
            pastedFiles.push({
                key,
                file,
                payload: {
                    filename: file.name,
                    content_type: file.type || 'application/octet-stream',
                    data: base64Data,
                },
            });
        }

        syncPastedFiles();
        updateStatus();
    }

    function extractClipboardFiles(event) {
        const files = [];
        const items = Array.from(event.clipboardData?.items || []);
        items.forEach((item, index) => {
            if (item.kind !== 'file') {
                return;
            }

            const file = item.getAsFile();
            if (!file) {
                return;
            }

            if (!file.name || file.name === 'image.png') {
                const extension = (file.type || 'image/png').split('/')[1] || 'png';
                files.push(new File([file], `schowek-${Date.now()}-${index + 1}.${extension}`, { type: file.type || 'image/png' }));
                return;
            }

            files.push(file);
        });
        return files;
    }

    async function handlePaste(event) {
        const files = extractClipboardFiles(event);
        if (!files.length) {
            return;
        }

        event.preventDefault();
        await addPastedFiles(files);
        pasteZone.classList.add('is-active');
        window.setTimeout(() => pasteZone.classList.remove('is-active'), 180);
    }

    fileInput.addEventListener('change', () => {
        addUploadFiles(fileInput.files);
    });

    pasteZone.addEventListener('paste', handlePaste);
    if (contentField) {
        contentField.addEventListener('paste', handlePaste);
    }

    pasteZone.addEventListener('click', () => pasteZone.focus());
    pasteZone.addEventListener('dragover', (event) => {
        event.preventDefault();
        pasteZone.classList.add('is-active');
    });
    pasteZone.addEventListener('dragleave', () => {
        pasteZone.classList.remove('is-active');
    });
    pasteZone.addEventListener('drop', (event) => {
        event.preventDefault();
        pasteZone.classList.remove('is-active');
        void addPastedFiles(event.dataTransfer?.files || []);
    });

    syncPastedFiles();
    updateStatus();
});