# Home Assistant Add-on: MariaDB

MariaDB database for Home Assistant and other add-ons that need a MySQL-compatible server.

## About

This repository wrapper exposes the official Home Assistant MariaDB add-on in this custom add-on repository.

Use this add-on when you need a local MySQL-compatible database for:

- Home Assistant recorder/history
- phpMyAdmin from this repository
- applications running in your other add-ons or containers

MariaDB is protocol-compatible with MySQL for typical Home Assistant use cases and publishes the `mysql` service expected by phpMyAdmin.