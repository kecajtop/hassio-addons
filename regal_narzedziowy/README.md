# Regal Narzedziowy add-on

Przykladowy dodatek Home Assistant dla aplikacji Regal Narzedziowy.

## Co robi

- buduje aktualna aplikacje Flask z katalogu `regal_narzedziowy`
- uruchamia panel na porcie `5001`
- pozwala ustawic osobno baze aplikacji i baze logowania `zakupy1`

## Gdzie jest dodatek

Katalog dodatku:

`zakupy/addons/regal_narzedziowy`

## Jak dodac do Home Assistant

1. Skopiuj katalog `regal_narzedziowy` do lokalnego repo dodatkow HA.
2. W Home Assistant dodaj lokalne repozytorium dodatkow, jesli jeszcze nie jest widoczne.
3. Otworz dodatek `Regal Narzedziowy`.
4. Ustaw parametry polaczenia do MySQL.
5. Uruchom dodatek.
6. Otworz `http://HOST_HA:5001`.

## Domyslne opcje

- `port`: `5001`
- `db_name`: `regal_narzedziowy`
- `auth_db_name`: `zakupy1`
- `auth_db_users_table`: `users`

## Uwagi

- Dodatek korzysta z aktualnej kopii aplikacji skopiowanej do `app/`.
- Jesli zmienisz aplikacje w katalogu `regal_narzedziowy`, skopiuj ponownie pliki do dodatku przed nowym buildem.
- Zaleznosci Pythona sa instalowane w `/opt/venv`, zeby ominac ograniczenia PEP 668 w bazowym obrazie Home Assistant.
- Port `5001` jest wystawiony jako zwykly port TCP, bez ingress.