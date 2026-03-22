import base64
import binascii
import io
import json
import mimetypes
import os
from contextlib import closing
from datetime import datetime, timedelta
from functools import wraps

import pymysql
from flask import Flask, abort, flash, g, jsonify, redirect, render_template, request, send_file, session, url_for
from pymysql.cursors import DictCursor
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash


ROLE_HIERARCHY = {
    "viewer": 1,
    "user": 2,
    "manager": 3,
    "admin": 4,
}

ROLE_PERMISSIONS = {
    "viewer": {"view"},
    "user": {"view", "add", "edit"},
    "manager": {"view", "add", "edit", "archive", "manage_racks"},
    "admin": {"view", "add", "edit", "archive", "delete", "manage_racks", "manage_users"},
}

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def create_app() -> Flask:
    app = Flask(__name__)
    base_dir = os.path.dirname(os.path.abspath(__file__))
    image_dir = os.getenv("IMAGE_UPLOAD_DIR", os.path.join(base_dir, "image"))
    session_duration = int(os.getenv("SESSION_DURATION_HOURS", "4"))
    app.config.update(
        SECRET_KEY=os.getenv("SECRET_KEY", "regal-narzedziowy-change-me"),
        SESSION_COOKIE_NAME=os.getenv("SESSION_COOKIE_NAME", "regal_narzedziowy_session"),
        APP_DB_HOST=os.getenv("DB_HOST", "10.0.3.1"),
        APP_DB_PORT=int(os.getenv("DB_PORT", "3306")),
        APP_DB_USER=os.getenv("DB_USER", "root"),
        APP_DB_PASSWORD=os.getenv("DB_PASSWORD", "regal"),
        APP_DB_NAME=os.getenv("DB_NAME", "regal_narzedziowy"),
        AUTH_DB_HOST=os.getenv("AUTH_DB_HOST", "10.0.3.1"),
        AUTH_DB_PORT=int(os.getenv("AUTH_DB_PORT", os.getenv("DB_PORT", "3306"))),
        AUTH_DB_USER=os.getenv("AUTH_DB_USER", "root"),
        AUTH_DB_PASSWORD=os.getenv("AUTH_DB_PASSWORD", "regal"),
        AUTH_DB_NAME=os.getenv("AUTH_DB_NAME", "zakupy1"),
        AUTH_DB_USERS_TABLE=os.getenv("AUTH_DB_USERS_TABLE", "users"),
        IMAGE_UPLOAD_DIR=image_dir,
        SESSION_DURATION_HOURS=session_duration,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=session_duration),
    )

    os.makedirs(app.config["IMAGE_UPLOAD_DIR"], exist_ok=True)

    users_table = app.config["AUTH_DB_USERS_TABLE"]
    if not users_table.replace("_", "").isalnum():
        raise RuntimeError("AUTH_DB_USERS_TABLE must be alphanumeric or underscore")

    def get_connection(*, auth_db: bool = False):
        prefix = "AUTH_DB" if auth_db else "APP_DB"
        return pymysql.connect(
            host=app.config[f"{prefix}_HOST"],
            port=app.config[f"{prefix}_PORT"],
            user=app.config[f"{prefix}_USER"],
            password=app.config[f"{prefix}_PASSWORD"],
            database=app.config[f"{prefix}_NAME"],
            charset="utf8mb4",
            cursorclass=DictCursor,
            autocommit=False,
        )

    def db_execute(query, params=None, *, fetchone=False, fetchall=False, commit=False, auth_db=False):
        with closing(get_connection(auth_db=auth_db)) as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, params or ())
                if commit:
                    connection.commit()
                if fetchone:
                    return cursor.fetchone()
                if fetchall:
                    return cursor.fetchall()
                return cursor.lastrowid

    def app_db_execute(query, params=None, **kwargs):
        return db_execute(query, params, auth_db=False, **kwargs)

    def auth_db_execute(query, params=None, **kwargs):
        return db_execute(query, params, auth_db=True, **kwargs)

    def ensure_app_schema():
        swap_axes_column = app_db_execute(
            "SHOW COLUMNS FROM racks LIKE %s",
            ("swap_axes",),
            fetchone=True,
        )
        if not swap_axes_column:
            app_db_execute(
                "ALTER TABLE racks ADD COLUMN swap_axes TINYINT(1) NOT NULL DEFAULT 0",
                commit=True,
            )

        tasks_table = app_db_execute("SHOW TABLES LIKE %s", ("tasks",), fetchone=True)
        if not tasks_table:
            app_db_execute(
                """
                CREATE TABLE tasks (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    description TEXT NULL,
                    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
                    due_date DATETIME NULL,
                    is_done TINYINT(1) NOT NULL DEFAULT 0,
                    created_by VARCHAR(120) NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
                """,
                commit=True,
            )

    def ensure_auth_schema():
        file_data_column = auth_db_execute(
            "SHOW COLUMNS FROM suggestion_attachments LIKE %s",
            ("file_data",),
            fetchone=True,
        )
        if not file_data_column:
            auth_db_execute(
                "ALTER TABLE suggestion_attachments ADD COLUMN file_data LONGBLOB NULL AFTER content_type",
                commit=True,
            )

    ensure_app_schema()
    ensure_auth_schema()

    def password_matches(password: str, password_hash: str) -> bool:
        if not password_hash:
            return False
        try:
            return check_password_hash(password_hash, password)
        except (ValueError, TypeError):
            return False
        except Exception:
            return False

    def normalize_role(value: str | None) -> str:
        role = (value or "user").strip().lower()
        return role if role in ROLE_HIERARCHY else "user"

    def has_permission(user: dict | None, permission: str) -> bool:
        if not user:
            return False
        role = normalize_role(user.get("role"))
        return permission in ROLE_PERMISSIONS.get(role, set())

    def build_full_name(user: dict) -> str:
        first_name = (user.get("first_name") or "").strip()
        last_name = (user.get("last_name") or "").strip()
        full_name = " ".join(part for part in [first_name, last_name] if part)
        return full_name or user.get("username") or "Uzytkownik"

    def is_user_active(auth_user: dict | None, local_user: dict | None) -> tuple[bool, str | None]:
        if not auth_user:
            return False, "Nie znaleziono użytkownika."
        if not local_user:
            return False, "Użytkownik nie ma przydzielonego dostępu do systemu regału narzędziowego."
        if int(local_user.get("is_active") or 0) != 1:
            return False, "Lokalne konto w systemie regału narzędziowego jest nieaktywne."
        return True, None

    def fetch_auth_user_by_username(username: str):
        return auth_db_execute(
            f"""
            SELECT id, username, password_hash, role, department, first_name, last_name
            FROM `{users_table}`
            WHERE username = %s
            LIMIT 1
            """,
            (username,),
            fetchone=True,
        )

    def fetch_auth_user_by_id(user_id: int):
        return auth_db_execute(
            f"""
            SELECT id, username, role, department, first_name, last_name, created_at
            FROM `{users_table}`
            WHERE id = %s
            LIMIT 1
            """,
            (user_id,),
            fetchone=True,
        )

    def fetch_auth_users(search_text="", role="", status="all"):
        sql = f"""
            SELECT id, username, role, department, first_name, last_name, created_at
            FROM `{users_table}`
            WHERE 1=1
        """
        params = []

        if search_text:
            like_value = f"%{search_text}%"
            sql += " AND (username LIKE %s OR first_name LIKE %s OR last_name LIKE %s OR department LIKE %s)"
            params.extend([like_value, like_value, like_value, like_value])

        if role:
            sql += " AND role = %s"
            params.append(role)

        sql += " ORDER BY username"
        return auth_db_execute(sql, params, fetchall=True)

    def fetch_local_user_by_username(username: str):
        return app_db_execute(
            """
            SELECT id, username, email, full_name, role, department, is_active, created_at, last_login
            FROM users
            WHERE username = %s
            LIMIT 1
            """,
            (username,),
            fetchone=True,
        )

    def fetch_local_users_map(usernames: list[str]):
        if not usernames:
            return {}

        placeholders = ", ".join(["%s"] * len(usernames))
        rows = app_db_execute(
            f"""
            SELECT id, username, email, full_name, role, department, is_active, created_at, last_login
            FROM users
            WHERE username IN ({placeholders})
            """,
            usernames,
            fetchall=True,
        )
        return {row["username"]: row for row in rows}

    def get_local_user_stats():
        stats = app_db_execute(
            """
            SELECT
                COUNT(*) AS total_local_users,
                SUM(CASE WHEN COALESCE(is_active, 0) = 1 THEN 1 ELSE 0 END) AS active_local_users,
                SUM(CASE WHEN role = 'manager' THEN 1 ELSE 0 END) AS manager_users,
                SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admin_users
            FROM users
            """,
            fetchone=True,
        )
        stats["configured_users"] = stats.get("total_local_users") or 0
        return stats

    def get_auth_user_stats():
        return auth_db_execute(
            f"""
            SELECT
                COUNT(*) AS total_users,
                SUM(CASE WHEN COALESCE(profile_locked, 0) = 0 THEN 1 ELSE 0 END) AS active_users,
                SUM(CASE WHEN COALESCE(profile_locked, 0) = 1 THEN 1 ELSE 0 END) AS locked_users,
                SUM(CASE WHEN COALESCE(can_access_items, 0) = 1 THEN 1 ELSE 0 END) AS rack_access_users
            FROM `{users_table}`
            """,
            fetchone=True,
        )

    def get_auth_roles():
        rows = auth_db_execute(
            f"SELECT DISTINCT role FROM `{users_table}` WHERE role IS NOT NULL AND role <> '' ORDER BY role",
            fetchall=True,
        )
        return [row["role"] for row in rows]

    def parse_checkbox(name: str) -> int:
        return 1 if request.form.get(name) == "on" else 0

    def parse_optional_datetime(value: str):
        raw_value = (value or "").strip()
        if not raw_value:
            return None
        for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d"):
            try:
                return datetime.strptime(raw_value, fmt)
            except ValueError:
                continue
        raise ValueError("Nieprawidłowy format daty.")

    def get_user_form_data(user=None):
        source = user or {}
        account_expiry = source.get("account_expiry")
        if isinstance(account_expiry, datetime):
            account_expiry = account_expiry.strftime("%Y-%m-%dT%H:%M")
        elif account_expiry is None:
            account_expiry = ""

        return {
            "username": source.get("username", ""),
            "first_name": source.get("first_name", ""),
            "last_name": source.get("last_name", ""),
            "role": normalize_role(source.get("role")),
            "department": source.get("department", ""),
            "account_expiry": account_expiry,
            "password_never_expires": int(source.get("password_never_expires") or 0),
            "can_order": int(source.get("can_order") or 0),
            "can_approve": int(source.get("can_approve") or 0),
            "can_access_items": int(source.get("can_access_items") or 0),
            "profile_locked": int(source.get("profile_locked") or 0),
        }

    def get_local_access_form_data(auth_user: dict, local_user: dict | None):
        return {
            "username": auth_user.get("username", ""),
            "full_name": build_full_name(auth_user),
            "department": auth_user.get("department", ""),
            "role": normalize_role((local_user or {}).get("role") or "viewer"),
            "is_active": int((local_user or {}).get("is_active") or 0),
            "last_login": (local_user or {}).get("last_login"),
        }

    def generate_local_email(username: str) -> str:
        safe_username = (username or "user").strip().lower().replace(" ", ".")
        return f"{safe_username}@regal.local"

    def upsert_local_user_access(auth_user: dict, form_data: dict):
        username = auth_user["username"]
        full_name = build_full_name(auth_user)
        department = auth_user.get("department") or None
        local_user = fetch_local_user_by_username(username)

        if local_user:
            app_db_execute(
                """
                UPDATE users
                SET full_name = %s,
                    role = %s,
                    department = %s,
                    is_active = %s
                WHERE username = %s
                """,
                (
                    full_name,
                    form_data["role"],
                    department,
                    form_data["is_active"],
                    username,
                ),
                commit=True,
            )
            return

        app_db_execute(
            """
            INSERT INTO users (username, email, password_hash, full_name, role, department, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                username,
                generate_local_email(username),
                generate_password_hash(f"local-access-only:{username}"),
                full_name,
                form_data["role"],
                department,
                form_data["is_active"],
            ),
            commit=True,
        )

    def merge_auth_and_local_users(auth_users: list[dict], status: str):
        local_users = fetch_local_users_map([user["username"] for user in auth_users])
        merged = []

        for auth_user in auth_users:
            local_user = local_users.get(auth_user["username"])
            merged_user = {
                "id": auth_user["id"],
                "username": auth_user["username"],
                "full_name": build_full_name(auth_user),
                "department": auth_user.get("department"),
                "auth_role": auth_user.get("role") or "brak",
                "created_at": auth_user.get("created_at"),
                "local_role": normalize_role(local_user.get("role")) if local_user else None,
                "local_is_active": int(local_user.get("is_active") or 0) if local_user else 0,
                "local_last_login": local_user.get("last_login") if local_user else None,
                "local_user_id": local_user.get("id") if local_user else None,
                "has_local_access": bool(local_user),
            }

            if status == "configured" and not merged_user["has_local_access"]:
                continue
            if status == "active-local" and not (merged_user["has_local_access"] and merged_user["local_is_active"]):
                continue
            if status == "inactive-local" and not (merged_user["has_local_access"] and not merged_user["local_is_active"]):
                continue
            if status == "missing-local" and merged_user["has_local_access"]:
                continue

            merged.append(merged_user)

        return merged

    def get_current_user():
        username = session.get("username")
        if not username:
            return None

        auth_user = fetch_auth_user_by_username(username)
        local_user = fetch_local_user_by_username(username)
        is_active, _ = is_user_active(auth_user, local_user)
        if not is_active:
            session.clear()
            return None

        return {
            "id": local_user["id"],
            "username": auth_user["username"],
            "full_name": build_full_name(auth_user),
            "role": normalize_role(local_user.get("role")),
            "department": local_user.get("department") or auth_user.get("department"),
        }

    def parse_int(value, default=0):
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return default

    def is_allowed_image(filename: str) -> bool:
        extension = os.path.splitext(filename or "")[1].lower()
        return extension in ALLOWED_IMAGE_EXTENSIONS

    def build_image_relative_path(filename: str) -> str:
        return f"image/{filename}".replace("\\", "/")

    def resolve_managed_image_path(image_value: str | None) -> str | None:
        normalized = (image_value or "").replace("\\", "/").strip().lstrip("/")
        if not normalized:
            return None
        if normalized.startswith("image/"):
            filename = resolve_image_filename(os.path.basename(normalized))
            if filename:
                return os.path.join(app.config["IMAGE_UPLOAD_DIR"], filename)
        return None

    def resolve_image_filename(filename: str | None) -> str | None:
        normalized = os.path.basename((filename or "").strip())
        if not normalized:
            return None

        exact_path = os.path.join(app.config["IMAGE_UPLOAD_DIR"], normalized)
        if os.path.isfile(exact_path):
            return normalized

        stem, _ = os.path.splitext(normalized)
        if not stem:
            return None

        for extension in sorted(ALLOWED_IMAGE_EXTENSIONS):
            candidate = f"{stem}{extension}"
            candidate_path = os.path.join(app.config["IMAGE_UPLOAD_DIR"], candidate)
            if os.path.isfile(candidate_path):
                return candidate

        return None

    def delete_managed_image(image_value: str | None):
        normalized = (image_value or "").replace("\\", "/").strip()
        candidate_paths = []

        if normalized.startswith("image/"):
            raw_filename = os.path.basename(normalized)
            candidate_paths.append(os.path.join(app.config["IMAGE_UPLOAD_DIR"], raw_filename))

        resolved_path = resolve_managed_image_path(image_value)
        if resolved_path:
            candidate_paths.append(resolved_path)

        seen = set()
        for file_path in candidate_paths:
            if not file_path or file_path in seen:
                continue
            seen.add(file_path)
            if not os.path.isfile(file_path):
                continue
            try:
                os.remove(file_path)
            except OSError:
                pass

    def save_uploaded_image(storage, tool_name: str, replace_image_value: str | None = None) -> str:
        original_name = secure_filename(storage.filename or "")
        if not original_name:
            raise ValueError("Nie wybrano pliku obrazu.")
        if not is_allowed_image(original_name):
            raise ValueError("Dozwolone rozszerzenia zdjęć: png, jpg, jpeg, webp, gif.")

        stem, extension = os.path.splitext(original_name)
        replacement_filename = resolve_image_filename(os.path.basename((replace_image_value or "").strip()))
        if replacement_filename:
            replacement_extension = os.path.splitext(replacement_filename)[1].lower()
            if replacement_extension == extension.lower():
                storage.save(os.path.join(app.config["IMAGE_UPLOAD_DIR"], replacement_filename))
                return build_image_relative_path(replacement_filename)

        safe_tool_name = secure_filename(tool_name) or "narzedzie"
        candidate = f"{safe_tool_name}{extension.lower()}"
        counter = 1
        target_path = os.path.join(app.config["IMAGE_UPLOAD_DIR"], candidate)
        while os.path.exists(target_path):
            candidate = f"{safe_tool_name}-{counter}{extension.lower()}"
            target_path = os.path.join(app.config["IMAGE_UPLOAD_DIR"], candidate)
            counter += 1

        storage.save(target_path)
        return build_image_relative_path(candidate)

    def tool_image_url(image_value: str | None) -> str | None:
        normalized = (image_value or "").replace("\\", "/").strip()
        if not normalized:
            return None
        if normalized.startswith(("http://", "https://")):
            return normalized
        if normalized.startswith("image/"):
            filename = resolve_image_filename(os.path.basename(normalized))
            if filename:
                return url_for("tool_image_file", filename=filename)
            return None
        return normalized

    def resolve_suggestion_attachment_path(file_value: str | None) -> str | None:
        raw_value = (file_value or "").strip()
        if not raw_value:
            return None

        if os.path.isabs(raw_value) and os.path.isfile(raw_value):
            return raw_value

        normalized = raw_value.replace("\\", "/").lstrip("/")

        filename = os.path.basename(normalized)
        if not filename:
            return None

        candidate_path = os.path.join(base_dir, "suggestions", filename)
        return candidate_path if os.path.isfile(candidate_path) else None

    def read_suggestion_attachment(storage) -> dict:
        original_name = secure_filename(storage.filename or "")
        if not original_name:
            raise ValueError("Jeden z załączników ma nieprawidłową nazwę pliku.")

        payload = storage.read()
        if payload is None:
            payload = b""

        return {
            "filename": original_name,
            "content_type": storage.mimetype or mimetypes.guess_type(original_name)[0] or "application/octet-stream",
            "file_data": payload,
        }

    def read_pasted_suggestion_attachments(raw_value: str | None) -> list[dict]:
        if not raw_value:
            return []

        try:
            payload = json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise ValueError("Nie udało się odczytać wklejonych obrazów.") from exc

        if not isinstance(payload, list):
            raise ValueError("Nieprawidłowy format wklejonych obrazów.")

        attachments = []
        for index, item in enumerate(payload, start=1):
            if not isinstance(item, dict):
                raise ValueError("Nieprawidłowy format wklejonych obrazów.")

            filename = secure_filename((item.get("filename") or "").strip()) or f"schowek-{datetime.now().strftime('%Y%m%d%H%M%S')}-{index}.png"
            encoded_data = item.get("data") or ""
            content_type = item.get("content_type") or mimetypes.guess_type(filename)[0] or "application/octet-stream"

            try:
                file_data = base64.b64decode(encoded_data, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ValueError("Jednego z wklejonych obrazów nie udało się zapisać.") from exc

            if not file_data:
                continue

            attachments.append(
                {
                    "filename": filename,
                    "content_type": content_type,
                    "file_data": file_data,
                }
            )

        return attachments

    def get_current_auth_user_id() -> int | None:
        auth_user_id = session.get("auth_user_id")
        if auth_user_id:
            return int(auth_user_id)
        if not g.user:
            return None

        auth_user = fetch_auth_user_by_username(g.user.get("username"))
        if not auth_user:
            return None
        return int(auth_user["id"])

    def fetch_suggestion_attachments_map(suggestion_ids: list[int]) -> dict[int, list[dict]]:
        if not suggestion_ids:
            return {}

        placeholders = ", ".join(["%s"] * len(suggestion_ids))
        rows = auth_db_execute(
            f"""
            SELECT id, suggestion_id, filename, filepath, content_type, file_data, created_at
            FROM suggestion_attachments
            WHERE suggestion_id IN ({placeholders})
            ORDER BY created_at ASC, id ASC
            """,
            suggestion_ids,
            fetchall=True,
        )

        attachments_map = {}
        for row in rows:
            attachments_map.setdefault(row["suggestion_id"], []).append(row)
        return attachments_map

    def fetch_suggestions(current_auth_user_id: int | None, *, include_all: bool = False, limit: int = 100) -> list[dict]:
        sql = f"""
            SELECT
                suggestions.id,
                suggestions.user_id,
                suggestions.topic,
                suggestions.content,
                suggestions.status,
                suggestions.created_at,
                users.username AS author_username,
                COALESCE(
                    NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM(users.first_name), ''), NULLIF(TRIM(users.last_name), ''))), ''),
                    users.username,
                    'Nieznany użytkownik'
                ) AS author_name
            FROM suggestions
            LEFT JOIN `{users_table}` AS users ON users.id = suggestions.user_id
            WHERE 1 = 1
        """
        params = []

        if not include_all:
            sql += " AND suggestions.user_id = %s"
            params.append(current_auth_user_id or 0)

        sql += " ORDER BY suggestions.created_at DESC, suggestions.id DESC LIMIT %s"
        params.append(limit)

        suggestions = auth_db_execute(sql, params, fetchall=True)
        attachments_map = fetch_suggestion_attachments_map([row["id"] for row in suggestions])
        for suggestion in suggestions:
            suggestion["attachments"] = attachments_map.get(suggestion["id"], [])
        return suggestions

    def create_suggestion(auth_user_id: int | None, topic: str, content: str, attachments: list, pasted_attachments: list[dict] | None = None) -> int:
        clean_topic = (topic or "").strip()
        clean_content = (content or "").strip()

        if not clean_topic:
            raise ValueError("Temat sugestii jest wymagany.")
        if not auth_user_id:
            raise ValueError("Nie udało się ustalić użytkownika zapisującego sugestię.")

        with closing(get_connection(auth_db=True)) as connection:
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO suggestions (user_id, topic, content) VALUES (%s, %s, %s)",
                        (auth_user_id, clean_topic, clean_content or None),
                    )
                    suggestion_id = cursor.lastrowid

                    for storage in attachments or []:
                        if not storage or not (storage.filename or "").strip():
                            continue

                        attachment = read_suggestion_attachment(storage)

                        cursor.execute(
                            """
                            INSERT INTO suggestion_attachments (suggestion_id, filename, filepath, content_type, file_data)
                            VALUES (%s, %s, %s, %s, %s)
                            """,
                            (
                                suggestion_id,
                                attachment["filename"],
                                None,
                                attachment["content_type"],
                                attachment["file_data"],
                            ),
                        )

                    for attachment in pasted_attachments or []:
                        if not attachment.get("file_data"):
                            continue

                        cursor.execute(
                            """
                            INSERT INTO suggestion_attachments (suggestion_id, filename, filepath, content_type, file_data)
                            VALUES (%s, %s, %s, %s, %s)
                            """,
                            (
                                suggestion_id,
                                attachment["filename"],
                                None,
                                attachment["content_type"],
                                attachment["file_data"],
                            ),
                        )

                connection.commit()
                return suggestion_id
            except Exception:
                connection.rollback()
                raise

    def fetch_racks():
        racks = app_db_execute(
            "SELECT id, name, shelves, description, orientation, COALESCE(swap_axes, 0) AS swap_axes FROM racks ORDER BY name",
            fetchall=True,
        )
        items = app_db_execute(
            """
            SELECT id, name, description, rack_id, shelf, position, size, led_count, led_space, qty,
                   link, stl, image, archive
            FROM items
            ORDER BY rack_id, shelf, position, name
            """,
            fetchall=True,
        )

        rack_map = {}
        for rack in racks:
            raw_shelves = rack.get("shelves") or ""
            rack["shelf_count"] = raw_shelves.count(",") + 1 if raw_shelves else 0
            rack["items"] = []
            rack_map[rack["id"]] = rack

        for item in items:
            rack = rack_map.get(item.get("rack_id"))
            if rack:
                rack["items"].append(item)

        return list(rack_map.values())

    def serialize_racks(racks: list[dict], *, include_archived: bool = True):
        serialized = []
        for rack in racks:
            items = rack.get("items") or []
            if not include_archived:
                items = [item for item in items if int(item.get("archive") or 0) == 0]

            serialized.append(
                {
                    "id": rack.get("id"),
                    "name": rack.get("name"),
                    "description": rack.get("description") or "",
                    "orientation": rack.get("orientation") or "H",
                    "swap_axes": int(rack.get("swap_axes") or 0),
                    "shelves": rack.get("shelves") or "",
                    "shelf_count": rack.get("shelf_count") or 0,
                    "items": [
                        {
                            "id": item.get("id"),
                            "name": item.get("name"),
                            "description": item.get("description") or "",
                            "rack_id": item.get("rack_id"),
                            "shelf": str(item.get("shelf") or ""),
                            "position": str(item.get("position") or ""),
                            "size": float(item.get("size") or 1),
                            "led_count": int(item.get("led_count") or 0),
                            "led_space": int(item.get("led_space") or 0),
                            "qty": int(item.get("qty") or 0),
                            "image": item.get("image") or "",
                            "image_url": tool_image_url(item.get("image")),
                            "link": item.get("link") or "",
                            "stl": item.get("stl") or "",
                            "archive": int(item.get("archive") or 0),
                        }
                        for item in items
                    ],
                }
            )

        return serialized

    def fetch_light_tools(search_text: str = ""):
        tools = fetch_tools(search_text, "", "active")
        return [
            {
                "id": tool.get("id"),
                "name": tool.get("name"),
                "description": tool.get("description") or "",
                "rack_id": tool.get("rack_id"),
                "rack_name": tool.get("rack_name") or "N/A",
                "shelf": str(tool.get("shelf") or ""),
                "position": str(tool.get("position") or ""),
                "size": float(tool.get("size") or 1),
                "qty": int(tool.get("qty") or 0),
                "image": tool.get("image") or "",
                "image_url": tool_image_url(tool.get("image")),
            }
            for tool in tools
            if int(tool.get("archive") or 0) == 0
        ]

    def get_rack(rack_id: int):
        return app_db_execute(
            "SELECT id, name, shelves, description, orientation, COALESCE(swap_axes, 0) AS swap_axes FROM racks WHERE id = %s",
            (rack_id,),
            fetchone=True,
        )

    def get_rack_form_data(rack=None):
        source = rack or {}
        return {
            "name": source.get("name", ""),
            "shelves": source.get("shelves", ""),
            "description": source.get("description", ""),
            "orientation": (source.get("orientation") or "H").strip().upper() or "H",
            "swap_axes": int(source.get("swap_axes") or 0),
        }

    def normalize_shelves(raw_value: str) -> str:
        cleaned = (raw_value or "").strip()
        if not cleaned:
            raise ValueError("Układ półek jest wymagany.")

        if cleaned.isdigit():
            shelf_count = int(cleaned)
            if shelf_count < 1:
                raise ValueError("Liczba półek musi być większa od zera.")
            return ",".join(str(index) for index in range(1, shelf_count + 1))

        parts = [part.strip() for part in cleaned.replace(";", ",").split(",") if part.strip()]
        if not parts:
            raise ValueError("Podaj przynajmniej jedną półkę.")
        return ",".join(parts)

    def count_rack_items(rack_id: int) -> int:
        result = app_db_execute(
            "SELECT COUNT(*) AS item_count FROM items WHERE rack_id = %s",
            (rack_id,),
            fetchone=True,
        )
        return int(result.get("item_count") or 0)

    def fetch_tools(search_text="", rack_id="", archived="all"):
        sql = """
            SELECT
                items.id,
                items.name,
                items.description,
                items.rack_id,
                racks.name AS rack_name,
                items.shelf,
                items.position,
                items.size,
                items.led_count,
                items.led_space,
                items.qty,
                items.image,
                items.stl,
                items.link,
                items.archive
            FROM items
            LEFT JOIN racks ON racks.id = items.rack_id
            WHERE 1=1
        """
        params = []

        if search_text:
            like_value = f"%{search_text}%"
            sql += " AND (items.name LIKE %s OR items.description LIKE %s OR racks.name LIKE %s)"
            params.extend([like_value, like_value, like_value])

        if rack_id:
            sql += " AND items.rack_id = %s"
            params.append(rack_id)

        if archived == "active":
            sql += " AND COALESCE(items.archive, 0) = 0"
        elif archived == "archived":
            sql += " AND COALESCE(items.archive, 0) = 1"

        sql += " ORDER BY COALESCE(items.archive, 0), racks.name, items.shelf, items.position, items.name"
        return app_db_execute(sql, params, fetchall=True)

    def get_tool(tool_id: int):
        return app_db_execute(
            """
            SELECT id, name, description, rack_id, shelf, position, size, led_count, led_space, qty,
                   image, stl, link, archive
            FROM items
            WHERE id = %s
            """,
            (tool_id,),
            fetchone=True,
        )

    def get_counts():
        totals = app_db_execute(
            """
            SELECT
                (SELECT COUNT(*) FROM racks) AS rack_count,
                (SELECT COUNT(*) FROM items) AS tool_count,
                (SELECT COUNT(*) FROM items WHERE COALESCE(archive, 0) = 0) AS active_count,
                (SELECT COUNT(*) FROM items WHERE COALESCE(archive, 0) = 1) AS archived_count
            """,
            fetchone=True,
        )
        recent = app_db_execute(
            """
            SELECT items.id, items.name, racks.name AS rack_name, items.shelf, items.position, items.archive
            FROM items
            LEFT JOIN racks ON racks.id = items.rack_id
            ORDER BY items.id DESC
            LIMIT 8
            """,
            fetchall=True,
        )
        return totals, recent

    def normalize_priority(value: str | None) -> str:
        priority = (value or "normal").strip().lower()
        return priority if priority in {"low", "normal", "high"} else "normal"

    def get_task_form_data(task=None):
        source = task or {}
        due_date = source.get("due_date")
        if isinstance(due_date, datetime):
            due_date = due_date.strftime("%Y-%m-%d")
        elif due_date is None:
            due_date = ""
        return {
            "title": source.get("title", ""),
            "description": source.get("description", ""),
            "priority": normalize_priority(source.get("priority")),
            "due_date": due_date,
            "is_done": int(source.get("is_done") or 0),
        }

    def fetch_tasks(include_done: bool = True):
        sql = "SELECT id, title, description, priority, due_date, is_done, created_by, created_at, updated_at FROM tasks"
        params = []
        if not include_done:
            sql += " WHERE COALESCE(is_done, 0) = 0"
        sql += " ORDER BY COALESCE(is_done, 0), CASE priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, COALESCE(due_date, '2999-12-31'), id DESC"
        return app_db_execute(sql, params, fetchall=True)

    def get_task(task_id: int):
        return app_db_execute(
            "SELECT id, title, description, priority, due_date, is_done, created_by, created_at, updated_at FROM tasks WHERE id = %s",
            (task_id,),
            fetchone=True,
        )

    def require_role(required_role):
        def decorator(view):
            @wraps(view)
            def wrapped(*args, **kwargs):
                if g.user is None:
                    return redirect(url_for("login"))
                current_level = ROLE_HIERARCHY.get(g.user.get("role"), 0)
                required_level = ROLE_HIERARCHY.get(required_role, 999)
                if current_level < required_level:
                    flash("Brak uprawnień do wykonania tej operacji.", "error")
                    return redirect(url_for("dashboard"))
                return view(*args, **kwargs)

            return wrapped

        return decorator

    def require_permission(permission: str):
        def decorator(view):
            @wraps(view)
            def wrapped(*args, **kwargs):
                if g.user is None:
                    return redirect(url_for("login"))
                if not has_permission(g.user, permission):
                    flash("Brak uprawnień do wykonania tej operacji.", "error")
                    return redirect(url_for("dashboard"))
                return view(*args, **kwargs)

            return wrapped

        return decorator

    def login_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if g.user is None:
                return redirect(url_for("login"))
            return view(*args, **kwargs)

        return wrapped

    @app.before_request
    def load_user():
        g.user = None
        if request.endpoint == "static":
            return
        session.permanent = True
        try:
            g.user = get_current_user()
        except Exception:
            session.clear()
            g.user = None

    @app.after_request
    def add_no_cache_headers(response):
        if request.endpoint in {
            "login",
            "logout",
            "dashboard",
            "help_page",
            "suggestions",
            "tools",
            "racks",
            "users",
            "user_edit",
            "tool_create",
            "tool_edit",
            "rack_create",
            "rack_edit",
        }:
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

    @app.route("/")
    @login_required
    def dashboard():
        totals, recent_tools = get_counts()
        racks = fetch_racks()
        tasks = fetch_tasks(include_done=False)[:8]
        return render_template(
            "dashboard.html",
            totals=totals,
            recent_tools=recent_tools,
            racks=racks,
            tasks=tasks,
        )

    @app.route("/help")
    @login_required
    def help_page():
        return render_template("help.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if g.user is not None:
            return redirect(url_for("dashboard"))

        error = None
        if request.method == "GET" and (session.get("user_id") or session.get("username")):
            session.clear()

        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")

            auth_user = fetch_auth_user_by_username(username)
            local_user = fetch_local_user_by_username(username) if auth_user else None
            is_active, inactive_message = is_user_active(auth_user, local_user)

            if not auth_user or not password_matches(password, auth_user.get("password_hash")):
                session.clear()
                error = "Nieprawidłowa nazwa użytkownika lub hasło."
            elif not is_active:
                session.clear()
                error = inactive_message or "Konto nie może się zalogować."
            else:
                session.clear()
                session["username"] = auth_user["username"]
                session["auth_user_id"] = auth_user["id"]
                return redirect(url_for("dashboard"))

        return render_template("login.html", error=error)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.route("/tools")
    @login_required
    def tools():
        search_text = request.args.get("q", "").strip()
        rack_id = request.args.get("rack_id", "").strip()
        archived = request.args.get("archived", "active")
        has_image = request.args.get("has_image", "0").strip() == "1"
        tool_rows = fetch_tools(search_text, rack_id, archived)
        if has_image:
            tool_rows = [tool for tool in tool_rows if tool_image_url(tool.get("image"))]
        racks = app_db_execute("SELECT id, name FROM racks ORDER BY name", fetchall=True)
        return render_template(
            "tools.html",
            tools=tool_rows,
            racks=racks,
            search_text=search_text,
            selected_rack_id=rack_id,
            archived=archived,
            has_image=has_image,
        )

    @app.route("/tasks")
    @login_required
    def tasks():
        show_done = request.args.get("show_done", "1").strip() != "0"
        task_rows = fetch_tasks(include_done=show_done)
        return render_template("tasks.html", tasks=task_rows, show_done=show_done)

    @app.route("/suggestions", methods=["GET", "POST"])
    @login_required
    def suggestions():
        form_data = {
            "topic": "",
            "content": "",
        }
        auth_user_id = get_current_auth_user_id()
        can_view_all = ROLE_HIERARCHY.get(g.user.get("role"), 0) >= ROLE_HIERARCHY["manager"]

        if request.method == "POST":
            form_data = {
                "topic": request.form.get("topic", "").strip(),
                "content": request.form.get("content", "").strip(),
            }

            try:
                pasted_attachments = read_pasted_suggestion_attachments(request.form.get("pasted_attachments"))
                create_suggestion(
                    auth_user_id,
                    form_data["topic"],
                    form_data["content"],
                    request.files.getlist("attachments"),
                    pasted_attachments,
                )
                flash("Sugestia została zapisana.", "success")
                return redirect(url_for("suggestions"))
            except ValueError as exc:
                flash(str(exc), "error")

        return render_template(
            "suggestions.html",
            form_data=form_data,
            suggestions=fetch_suggestions(auth_user_id, include_all=can_view_all),
            can_view_all=can_view_all,
        )

    @app.route("/tasks/new", methods=["GET", "POST"])
    @require_role("user")
    def task_create():
        form_data = get_task_form_data()
        if request.method == "POST":
            form_data = {
                "title": request.form.get("title", "").strip(),
                "description": request.form.get("description", "").strip(),
                "priority": normalize_priority(request.form.get("priority", "normal")),
                "due_date": request.form.get("due_date", "").strip(),
                "is_done": parse_checkbox("is_done"),
            }
            if not form_data["title"]:
                flash("Tytuł zadania jest wymagany.", "error")
            else:
                try:
                    due_date = parse_optional_datetime(form_data["due_date"])
                    app_db_execute(
                        "INSERT INTO tasks (title, description, priority, due_date, is_done, created_by) VALUES (%s, %s, %s, %s, %s, %s)",
                        (
                            form_data["title"],
                            form_data["description"],
                            form_data["priority"],
                            due_date,
                            form_data["is_done"],
                            g.user.get("username") if g.user else None,
                        ),
                        commit=True,
                    )
                    flash("Zadanie zostało dodane.", "success")
                    return redirect(url_for("tasks"))
                except ValueError as exc:
                    flash(str(exc), "error")
        return render_template("task_form.html", task=None, form_data=form_data)

    @app.route("/tasks/<int:task_id>/edit", methods=["GET", "POST"])
    @require_role("user")
    def task_edit(task_id: int):
        task = get_task(task_id)
        if not task:
            flash("Nie znaleziono zadania.", "error")
            return redirect(url_for("tasks"))
        form_data = get_task_form_data(task)
        if request.method == "POST":
            form_data = {
                "title": request.form.get("title", "").strip(),
                "description": request.form.get("description", "").strip(),
                "priority": normalize_priority(request.form.get("priority", "normal")),
                "due_date": request.form.get("due_date", "").strip(),
                "is_done": parse_checkbox("is_done"),
            }
            if not form_data["title"]:
                flash("Tytuł zadania jest wymagany.", "error")
            else:
                try:
                    due_date = parse_optional_datetime(form_data["due_date"])
                    app_db_execute(
                        "UPDATE tasks SET title = %s, description = %s, priority = %s, due_date = %s, is_done = %s WHERE id = %s",
                        (
                            form_data["title"],
                            form_data["description"],
                            form_data["priority"],
                            due_date,
                            form_data["is_done"],
                            task_id,
                        ),
                        commit=True,
                    )
                    flash("Zadanie zostało zapisane.", "success")
                    return redirect(url_for("tasks"))
                except ValueError as exc:
                    flash(str(exc), "error")
        return render_template("task_form.html", task=task, form_data=form_data)

    @app.route("/tasks/<int:task_id>/toggle", methods=["POST"])
    @login_required
    def task_toggle(task_id: int):
        task = get_task(task_id)
        if not task:
            flash("Nie znaleziono zadania.", "error")
            return redirect(url_for("tasks"))
        next_state = 0 if int(task.get("is_done") or 0) else 1
        app_db_execute("UPDATE tasks SET is_done = %s WHERE id = %s", (next_state, task_id), commit=True)
        flash("Status zadania został zmieniony.", "success")
        return redirect(url_for("tasks"))

    @app.route("/tasks/<int:task_id>/delete", methods=["POST"])
    @require_role("manager")
    def task_delete(task_id: int):
        app_db_execute("DELETE FROM tasks WHERE id = %s", (task_id,), commit=True)
        flash("Zadanie zostało usunięte.", "success")
        return redirect(url_for("tasks"))

    @app.route("/image/<path:filename>")
    def tool_image_file(filename: str):
        resolved_filename = resolve_image_filename(filename)
        if not resolved_filename:
            abort(404)

        file_path = os.path.join(app.config["IMAGE_UPLOAD_DIR"], resolved_filename)
        if not os.path.isfile(file_path):
            abort(404)

        mime_type, _ = mimetypes.guess_type(file_path)
        with open(file_path, "rb") as image_file:
            payload = io.BytesIO(image_file.read())

        payload.seek(0)
        return send_file(
            payload,
            mimetype=mime_type or "application/octet-stream",
            download_name=resolved_filename,
            conditional=False,
            etag=False,
            max_age=86400,
        )

    @app.route("/users")
    @require_role("admin")
    def users():
        search_text = request.args.get("q", "").strip()
        role = request.args.get("role", "").strip()
        status = request.args.get("status", "all").strip() or "all"
        auth_users = fetch_auth_users(search_text, role, "all")
        merged_users = merge_auth_and_local_users(auth_users, status)
        user_stats = get_local_user_stats()
        user_stats["auth_total_users"] = len(auth_users)
        return render_template(
            "users.html",
            users=merged_users,
            roles=get_auth_roles(),
            user_stats=user_stats,
            search_text=search_text,
            selected_role=role,
            selected_status=status,
        )

    @app.route("/users/<int:user_id>/edit", methods=["GET", "POST"])
    @require_role("admin")
    def user_edit(user_id: int):
        auth_user = fetch_auth_user_by_id(user_id)
        if not auth_user:
            flash("Nie znaleziono użytkownika.", "error")
            return redirect(url_for("users"))

        local_user = fetch_local_user_by_username(auth_user["username"])
        form_data = get_local_access_form_data(auth_user, local_user)
        if request.method == "POST":
            form_data = {
                "role": normalize_role(request.form.get("role", "viewer")),
                "is_active": parse_checkbox("is_active"),
            }

            try:
                upsert_local_user_access(auth_user, form_data)
                flash("Lokalne uprawnienia użytkownika zostały zapisane w bazie regal_narzedziowy.", "success")
                return redirect(url_for("users"))
            except pymysql.IntegrityError:
                flash("Nie udało się zapisać lokalnego dostępu użytkownika.", "error")

        return render_template(
            "user_form.html",
            auth_user=auth_user,
            local_user=local_user,
            form_data=form_data,
            roles=list(ROLE_HIERARCHY.keys()),
        )

    @app.route("/racks/new", methods=["GET", "POST"])
    @require_permission("manage_racks")
    def rack_create():
        form_data = get_rack_form_data()

        if request.method == "POST":
            form_data = {
                "name": request.form.get("name", "").strip(),
                "shelves": request.form.get("shelves", "").strip(),
                "description": request.form.get("description", "").strip(),
                "orientation": (request.form.get("orientation", "H").strip().upper() or "H"),
                "swap_axes": parse_checkbox("swap_axes"),
            }

            if not form_data["name"]:
                flash("Nazwa regału jest wymagana.", "error")
            else:
                try:
                    form_data["shelves"] = normalize_shelves(form_data["shelves"])
                    if form_data["orientation"] not in {"H", "V"}:
                        raise ValueError("Orientacja musi mieć wartość H lub V.")
                    app_db_execute(
                        "INSERT INTO racks (name, shelves, description, orientation, swap_axes) VALUES (%s, %s, %s, %s, %s)",
                        (
                            form_data["name"],
                            form_data["shelves"],
                            form_data["description"],
                            form_data["orientation"],
                            form_data["swap_axes"],
                        ),
                        commit=True,
                    )
                    flash("Regał został utworzony.", "success")
                    return redirect(url_for("racks"))
                except ValueError as exc:
                    flash(str(exc), "error")

        return render_template("rack_form.html", rack=None, form_data=form_data)

    @app.route("/racks/<int:rack_id>/edit", methods=["GET", "POST"])
    @require_permission("manage_racks")
    def rack_edit(rack_id: int):
        rack = get_rack(rack_id)
        if not rack:
            flash("Nie znaleziono regału.", "error")
            return redirect(url_for("racks"))

        form_data = get_rack_form_data(rack)
        if request.method == "POST":
            form_data = {
                "name": request.form.get("name", "").strip(),
                "shelves": request.form.get("shelves", "").strip(),
                "description": request.form.get("description", "").strip(),
                "orientation": (request.form.get("orientation", "H").strip().upper() or "H"),
                "swap_axes": parse_checkbox("swap_axes"),
            }

            if not form_data["name"]:
                flash("Nazwa regału jest wymagana.", "error")
            else:
                try:
                    form_data["shelves"] = normalize_shelves(form_data["shelves"])
                    if form_data["orientation"] not in {"H", "V"}:
                        raise ValueError("Orientacja musi mieć wartość H lub V.")
                    app_db_execute(
                        "UPDATE racks SET name = %s, shelves = %s, description = %s, orientation = %s, swap_axes = %s WHERE id = %s",
                        (
                            form_data["name"],
                            form_data["shelves"],
                            form_data["description"],
                            form_data["orientation"],
                            form_data["swap_axes"],
                            rack_id,
                        ),
                        commit=True,
                    )
                    flash("Regał został zaktualizowany.", "success")
                    return redirect(url_for("racks"))
                except ValueError as exc:
                    flash(str(exc), "error")

        return render_template("rack_form.html", rack=rack, form_data=form_data)

    @app.route("/racks/<int:rack_id>/delete", methods=["POST"])
    @require_permission("manage_racks")
    def rack_delete(rack_id: int):
        rack = get_rack(rack_id)
        if not rack:
            flash("Nie znaleziono regału.", "error")
            return redirect(url_for("racks"))

        if count_rack_items(rack_id) > 0:
            flash("Nie można usunąć regału, który ma przypisane narzędzia.", "error")
            return redirect(url_for("racks"))

        app_db_execute("DELETE FROM racks WHERE id = %s", (rack_id,), commit=True)
        flash("Regał został usunięty.", "success")
        return redirect(url_for("racks"))

    @app.route("/tools/new", methods=["GET", "POST"])
    @require_role("user")
    def tool_create():
        return handle_tool_form()

    @app.route("/tools/<int:tool_id>/edit", methods=["GET", "POST"])
    @require_role("user")
    def tool_edit(tool_id: int):
        tool = get_tool(tool_id)
        if not tool:
            flash("Nie znaleziono narzędzia.", "error")
            return redirect(url_for("tools"))
        return handle_tool_form(tool)

    def handle_tool_form(tool=None):
        racks = app_db_execute("SELECT id, name FROM racks ORDER BY name", fetchall=True)
        initial_rack_id = request.args.get("rack_id", "").strip()
        initial_shelf = request.args.get("shelf", "").strip()
        initial_position = request.args.get("position", "").strip()
        form_data = tool or {
            "name": "",
            "description": "",
            "rack_id": initial_rack_id,
            "shelf": initial_shelf,
            "position": initial_position,
            "size": "1",
            "led_count": 1,
            "led_space": 1,
            "qty": 1,
            "image": "",
            "stl": "",
            "link": "",
            "archive": 0,
        }
        form_data["image_url"] = tool_image_url(form_data.get("image"))
        form_data["image_missing"] = bool(form_data.get("image") and not form_data.get("image_url"))

        if request.method == "POST":
            form_data = {
                "name": request.form.get("name", "").strip(),
                "description": request.form.get("description", "").strip(),
                "rack_id": request.form.get("rack_id", "").strip(),
                "shelf": request.form.get("shelf", "").strip(),
                "position": request.form.get("position", "").strip(),
                "size": request.form.get("size", "1").strip() or "1",
                "led_count": parse_int(request.form.get("led_count", "1"), 1),
                "led_space": parse_int(request.form.get("led_space", "1"), 1),
                "qty": parse_int(request.form.get("qty", "1"), 1),
                "image": request.form.get("image", "").strip(),
                "stl": request.form.get("stl", "").strip(),
                "link": request.form.get("link", "").strip(),
                "archive": 1 if request.form.get("archive") == "on" else 0,
            }
            form_data["image_url"] = tool_image_url(form_data.get("image"))
            form_data["image_missing"] = bool(form_data.get("image") and not form_data.get("image_url"))

            missing_fields = [field for field in ["name", "rack_id", "shelf", "position"] if not form_data[field]]
            if missing_fields:
                flash("Wypełnij wymagane pola: nazwa, regał, półka, pozycja.", "error")
            else:
                try:
                    current_image = (tool or {}).get("image", "")
                    uploaded_image = request.files.get("image_file")
                    remove_image = request.form.get("remove_image") == "on"
                    image_value = form_data["image"]

                    if remove_image:
                        delete_managed_image(current_image)
                        image_value = ""

                    if uploaded_image and uploaded_image.filename:
                        image_value = save_uploaded_image(uploaded_image, form_data["name"], replace_image_value=current_image)
                        if current_image and current_image != image_value:
                            delete_managed_image(current_image)

                    form_data["image"] = image_value
                    form_data["image_url"] = tool_image_url(image_value)
                    form_data["image_missing"] = bool(form_data.get("image") and not form_data.get("image_url"))

                    payload = (
                        form_data["name"],
                        form_data["description"],
                        form_data["rack_id"],
                        form_data["shelf"],
                        form_data["position"],
                        form_data["size"],
                        form_data["led_count"],
                        form_data["led_space"],
                        form_data["qty"],
                        form_data["image"],
                        form_data["stl"],
                        form_data["link"],
                        form_data["archive"],
                    )
                    if tool:
                        app_db_execute(
                            """
                            UPDATE items
                            SET name=%s, description=%s, rack_id=%s, shelf=%s, position=%s, size=%s,
                                led_count=%s, led_space=%s, qty=%s, image=%s, stl=%s, link=%s, archive=%s
                            WHERE id=%s
                            """,
                            payload + (tool["id"],),
                            commit=True,
                        )
                        flash("Narzędzie zostało zaktualizowane.", "success")
                    else:
                        app_db_execute(
                            """
                            INSERT INTO items
                                (name, description, rack_id, shelf, position, size, led_count, led_space, qty, image, stl, link, archive)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            payload,
                            commit=True,
                        )
                        flash("Narzędzie zostało dodane.", "success")
                    return redirect(url_for("tools"))
                except ValueError as exc:
                    flash(str(exc), "error")

        return render_template("tool_form.html", tool=tool, form_data=form_data, racks=racks)

    @app.route("/tools/<int:tool_id>/archive", methods=["POST"])
    @require_role("manager")
    def tool_archive(tool_id: int):
        app_db_execute(
            "UPDATE items SET archive = 1 WHERE id = %s",
            (tool_id,),
            commit=True,
        )
        flash("Narzędzie zostało zarchiwizowane.", "success")
        return redirect(url_for("tools"))

    @app.route("/tools/<int:tool_id>/delete", methods=["POST"])
    @require_role("admin")
    def tool_delete(tool_id: int):
        tool = get_tool(tool_id)
        if tool:
            delete_managed_image(tool.get("image"))
        app_db_execute("DELETE FROM items WHERE id = %s", (tool_id,), commit=True)
        flash("Narzędzie zostało usunięte.", "success")
        return redirect(url_for("tools"))

    @app.route("/tools/<int:tool_id>/image/delete", methods=["POST"])
    @require_role("user")
    def tool_image_delete(tool_id: int):
        tool = get_tool(tool_id)
        if not tool:
            flash("Nie znaleziono narzędzia.", "error")
            return redirect(url_for("tools"))

        if not tool.get("image"):
            flash("To narzędzie nie ma przypisanego zdjęcia.", "error")
            return redirect(url_for("tool_edit", tool_id=tool_id))

        delete_managed_image(tool.get("image"))
        app_db_execute("UPDATE items SET image = '' WHERE id = %s", (tool_id,), commit=True)
        flash("Zdjęcie zostało usunięte.", "success")
        return redirect(url_for("tool_edit", tool_id=tool_id))

    @app.route("/tools/<int:tool_id>/move", methods=["POST"])
    @require_role("user")
    def tool_move(tool_id: int):
        rack_id = request.form.get("rack_id", "").strip()
        shelf = request.form.get("shelf", "").strip()
        position = request.form.get("position", "").strip()

        if not rack_id or not shelf or not position:
            flash("Przeniesienie wymaga regału, półki i pozycji.", "error")
            return redirect(url_for("racks"))

        app_db_execute(
            "UPDATE items SET rack_id = %s, shelf = %s, position = %s WHERE id = %s",
            (rack_id, shelf, position, tool_id),
            commit=True,
        )
        flash("Pozycja narzędzia została zmieniona.", "success")
        return redirect(url_for("racks"))

    @app.route("/racks")
    @login_required
    def racks():
        rack_rows = fetch_racks()
        return render_template(
            "racks.html",
            racks=rack_rows,
            racks_json=serialize_racks(rack_rows, include_archived=True),
            can_add_tools=has_permission(g.user, "add"),
            can_edit_tools=has_permission(g.user, "edit"),
            can_delete_tools=has_permission(g.user, "delete"),
            can_move_tools=has_permission(g.user, "edit"),
            can_manage_racks=has_permission(g.user, "manage_racks"),
        )

    @app.route("/light")
    def light_mode():
        return render_template("light.html")

    @app.route("/api/session")
    def api_session():
        if g.user is None:
            return jsonify({"authenticated": False})
        return jsonify({"authenticated": True, "user": g.user})

    @app.route("/api/racks")
    @login_required
    def api_racks():
        return jsonify(fetch_racks())

    @app.route("/api/light/racks")
    def api_light_racks():
        return jsonify(serialize_racks(fetch_racks(), include_archived=False))

    @app.route("/api/light/tools")
    def api_light_tools():
        query = request.args.get("q", "").strip()
        tools = fetch_light_tools(query)
        return jsonify(
            {
                "status": "success",
                "count": len(tools),
                "query": query,
                "tools": tools,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
        )

    @app.route("/api/tools")
    @login_required
    def api_tools():
        return jsonify(
            fetch_tools(
                request.args.get("q", "").strip(),
                request.args.get("rack_id", "").strip(),
                request.args.get("archived", "all").strip(),
            )
        )

    @app.route("/api/users")
    @require_role("admin")
    def api_users():
        auth_users = fetch_auth_users(
            request.args.get("q", "").strip(),
            request.args.get("role", "").strip(),
            "all",
        )
        return jsonify(merge_auth_and_local_users(auth_users, request.args.get("status", "all").strip() or "all"))

    @app.route("/suggestions/attachments/<int:attachment_id>")
    @login_required
    def suggestion_attachment_download(attachment_id: int):
        attachment = auth_db_execute(
            """
            SELECT
                suggestion_attachments.id,
                suggestion_attachments.suggestion_id,
                suggestion_attachments.filename,
                suggestion_attachments.filepath,
                suggestion_attachments.content_type,
                suggestion_attachments.file_data,
                suggestions.user_id
            FROM suggestion_attachments
            INNER JOIN suggestions ON suggestions.id = suggestion_attachments.suggestion_id
            WHERE suggestion_attachments.id = %s
            LIMIT 1
            """,
            (attachment_id,),
            fetchone=True,
        )
        if not attachment:
            abort(404)

        auth_user_id = get_current_auth_user_id()
        current_level = ROLE_HIERARCHY.get(g.user.get("role"), 0)
        if int(attachment.get("user_id") or 0) != int(auth_user_id or 0) and current_level < ROLE_HIERARCHY["manager"]:
            abort(403)

        file_data = attachment.get("file_data")
        if file_data is None:
            file_path = resolve_suggestion_attachment_path(attachment.get("filepath"))
            if not file_path:
                abort(404)

            with open(file_path, "rb") as file_handle:
                file_data = file_handle.read()

        payload = io.BytesIO(file_data)

        return send_file(
            payload,
            mimetype=attachment.get("content_type") or mimetypes.guess_type(attachment.get("filename") or "")[0] or "application/octet-stream",
            as_attachment=True,
            download_name=attachment.get("filename") or os.path.basename(file_path),
        )

    @app.route("/health")
    def health():
        try:
            app_db_execute("SELECT 1", fetchone=True)
            auth_db_execute(f"SELECT 1 FROM `{users_table}` LIMIT 1", fetchone=True)
            return jsonify(
                {
                    "status": "ok",
                    "app_database": app.config["APP_DB_NAME"],
                    "auth_database": app.config["AUTH_DB_NAME"],
                }
            )
        except pymysql.MySQLError as exc:
            return jsonify({"status": "error", "database": str(exc)}), 500

    @app.context_processor
    def inject_helpers():
        return {
            "role_hierarchy": ROLE_HIERARCHY,
            "has_permission": has_permission,
            "tool_image_url": tool_image_url,
        }

    @app.errorhandler(pymysql.MySQLError)
    def handle_database_error(error):
        if request.path.startswith("/api/"):
            return jsonify({"success": False, "error": str(error)}), 500
        flash("Nie udało się połączyć z bazą danych MySQL.", "error")
        return redirect(url_for("login"))

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5001")), debug=True)