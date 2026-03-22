document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('tool-image-modal');
    const preview = document.getElementById('tool-image-modal-preview');
    const title = document.getElementById('tool-image-modal-title');

    if (!modal || !preview || !title) {
        return;
    }

    function closeModal() {
        modal.classList.add('is-hidden');
        modal.setAttribute('aria-hidden', 'true');
        preview.removeAttribute('src');
    }

    function openModal(imageUrl, imageTitle) {
        if (!imageUrl) {
            return;
        }

        preview.src = imageUrl;
        preview.alt = imageTitle || 'Podgląd zdjęcia narzędzia';
        title.textContent = imageTitle || 'Podgląd zdjęcia';
        modal.classList.remove('is-hidden');
        modal.setAttribute('aria-hidden', 'false');
    }

    document.querySelectorAll('[data-image-url]').forEach((element) => {
        element.addEventListener('click', () => {
            openModal(element.dataset.imageUrl, element.dataset.imageTitle);
        });
    });

    modal.querySelectorAll('[data-close-image-modal="true"]').forEach((element) => {
        element.addEventListener('click', closeModal);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.classList.contains('is-hidden')) {
            closeModal();
        }
    });
});