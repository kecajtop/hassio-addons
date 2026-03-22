# Zakupy Web add-on

Ten add-on uruchamia aplikacje z katalogu `/config/zakupy`.

Wymagane pliki w Home Assistant:

- `/config/zakupy/app.py`
- `/config/zakupy/config.py`
- `/config/zakupy/config_secret.py`
- `/config/zakupy/models.py`
- `/config/zakupy/web_client/`

Add-on nie pakuje calego kodu z repo do obrazu. Jest to wrapper uruchamiajacy pliki juz skopiowane do `config`.

Port domyslny: `5000`
