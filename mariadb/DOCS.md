# Home Assistant Add-on: MariaDB

## Installation

1. Add this repository to Home Assistant.
2. Install the `MariaDB` add-on.
3. Set a strong password in `logins`.
4. Start the add-on.

## Configuration

Example configuration:

```yaml
databases:
  - homeassistant
logins:
  - username: homeassistant
    password: CHANGE_ME
rights:
  - username: homeassistant
    database: homeassistant
```

### `databases`

List of databases to create.

### `logins`

List of database users to create.

### `rights`

List of grants to assign to users for selected databases.

### `mariadb_server_args`

Optional extra server arguments, for example:

```yaml
mariadb_server_args:
  - --innodb_buffer_pool_size=512M
```

## Notes

- This add-on provides the `mysql` service, so the phpMyAdmin add-on in this repository can use it automatically.
- Port `3306` is optional and closed by default. Expose it only if you need external access.
- For Home Assistant recorder, use a MariaDB/MySQL connection string that matches your add-on hostname and user/database configuration.