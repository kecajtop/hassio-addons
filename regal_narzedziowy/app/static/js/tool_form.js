document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('image-file-input');
    const preview = document.getElementById('tool-image-preview');
    const card = document.getElementById('image-manager-card');
    const noImageNote = document.getElementById('no-image-note');
    const selectedLabel = document.getElementById('selected-image-label');
    const currentLabel = document.getElementById('current-image-label');
    const removeWrap = document.getElementById('remove-image-wrap');
    const removeCheckbox = document.getElementById('remove-image-checkbox');

    if (!fileInput || !preview || !card || !noImageNote || !selectedLabel) {
        return;
    }

    function showPreview(src, filename, isTemporary) {
        preview.src = src;
        card.classList.remove('is-hidden');
        noImageNote.classList.add('is-hidden');
        if (isTemporary) {
            selectedLabel.textContent = `Wybrany plik do zapisania: ${filename}`;
        } else {
            selectedLabel.textContent = 'Po wybraniu pliku pojawi się tutaj podgląd przed zapisem.';
        }
    }

    function hidePreviewIfEmpty() {
        const hasServerImage = Boolean((currentLabel?.textContent || '').toLowerCase().includes('aktualny plik:') && !(currentLabel?.textContent || '').toLowerCase().endsWith('brak'));
        if (hasServerImage) {
            return;
        }
        preview.removeAttribute('src');
        card.classList.add('is-hidden');
        noImageNote.classList.remove('is-hidden');
        selectedLabel.textContent = 'Po wybraniu pliku pojawi się tutaj podgląd przed zapisem.';
    }

    fileInput.addEventListener('change', () => {
        const [file] = fileInput.files || [];
        if (!file) {
            hidePreviewIfEmpty();
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        showPreview(objectUrl, file.name, true);
        if (removeCheckbox) {
            removeCheckbox.checked = false;
        }
        if (removeWrap) {
            removeWrap.classList.remove('is-hidden');
        }
    });

    if (removeCheckbox) {
        removeCheckbox.addEventListener('change', () => {
            if (!removeCheckbox.checked) {
                return;
            }
            fileInput.value = '';
            hidePreviewIfEmpty();
        });
    }
});