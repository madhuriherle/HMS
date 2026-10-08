import copy
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from main import app


OUTPUT = Path(__file__).resolve().parents[1] / "docs" / "HMS_MMA_API.postman_collection.json"
API_PREFIX = "/api/v1"


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _resolve_ref(schema: dict[str, Any], components: dict[str, Any]) -> dict[str, Any]:
    ref = schema.get("$ref")
    if not ref:
        return schema
    name = ref.rsplit("/", 1)[-1]
    return components.get(name, {})


def _example_from_schema(schema: dict[str, Any], components: dict[str, Any]) -> Any:
    schema = _resolve_ref(schema, components)

    if "example" in schema:
        return schema["example"]
    if "default" in schema:
        return schema["default"]
    if "anyOf" in schema:
        candidates = [item for item in schema["anyOf"] if item.get("type") != "null"]
        return _example_from_schema(candidates[0], components) if candidates else None
    if "oneOf" in schema:
        return _example_from_schema(schema["oneOf"][0], components) if schema["oneOf"] else None
    if "allOf" in schema:
        merged: dict[str, Any] = {"type": "object", "properties": {}}
        for item in schema["allOf"]:
            resolved = _resolve_ref(item, components)
            merged["properties"].update(resolved.get("properties", {}))
        return _example_from_schema(merged, components)

    schema_type = schema.get("type")
    fmt = schema.get("format")
    enum = schema.get("enum")
    if enum:
        return enum[0]
    if schema_type == "object" or "properties" in schema:
        return {
            key: _example_from_schema(value, components)
            for key, value in schema.get("properties", {}).items()
        }
    if schema_type == "array":
        return [_example_from_schema(schema.get("items", {}), components)]
    if schema_type == "integer":
        return 1
    if schema_type == "number":
        return 100.0
    if schema_type == "boolean":
        return True
    if fmt == "date":
        return "2026-10-04"
    if fmt == "date-time":
        return "2026-10-04T00:00:00Z"
    if fmt == "binary":
        return ""
    return "string"


def _query_item(key: str, value: Any, description: str = "", disabled: bool = False) -> dict[str, Any]:
    return {
        "key": key,
        "value": "" if value is None else str(value),
        "disabled": disabled,
        "description": description,
    }


def _url(
    path: str,
    parameters: list[dict[str, Any]],
    extra_query: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    is_api_path = path.startswith(API_PREFIX)
    base_variable = "{{baseUrl}}" if is_api_path else "{{serverUrl}}"
    path_without_prefix = path.removeprefix(API_PREFIX).lstrip("/") if is_api_path else path.lstrip("/")
    path_parts = [part for part in path_without_prefix.split("/") if part]
    variable = []
    query = []

    for parameter in parameters:
        location = parameter.get("in")
        name = parameter.get("name")
        if not name:
            continue
        if location == "path":
            variable.append({"key": name, "value": f"<{name}>", "description": parameter.get("description", "")})
        elif location == "query":
            query.append(_query_item(
                name,
                _example_from_schema(parameter.get("schema", {}), {}),
                parameter.get("description", ""),
                disabled=not parameter.get("required", False),
            ))

    if extra_query:
        existing = {item["key"] for item in query}
        for item in extra_query:
            if item["key"] not in existing:
                query.append(item)
                existing.add(item["key"])

    raw = base_variable + ("/" + path_without_prefix if path_without_prefix else "")
    enabled_query = [item for item in query if not item.get("disabled")]
    if enabled_query:
        raw += "?" + "&".join(f"{item['key']}={item['value']}" for item in enabled_query)
    return {
        "raw": raw,
        "host": [base_variable],
        "path": path_parts,
        "query": query,
        "variable": variable,
    }


def _query_from_object(prefix: str, value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        items: list[dict[str, Any]] = []
        for key, child in value.items():
            child_key = f"{prefix}.{key}" if prefix else key
            items.extend(_query_from_object(child_key, child))
        return items
    if isinstance(value, list):
        return [_query_item(prefix, json.dumps(value), "Body field mirrored into URL params.")]
    return [_query_item(prefix, value, "Body field mirrored into URL params.")]


def _body_query_params(operation: dict[str, Any], components: dict[str, Any], path: str) -> list[dict[str, Any]]:
    if path == f"{API_PREFIX}/auth/login":
        return [
            _query_item("username", "{{username}}", "Login form field mirrored into URL params."),
            _query_item("password", "{{password}}", "Login form field mirrored into URL params."),
        ]

    request_body = operation.get("requestBody", {})
    content = request_body.get("content", {})

    if "application/json" in content:
        schema = content["application/json"].get("schema", {})
        example = _example_from_schema(schema, components)
        return _query_from_object("", example) if isinstance(example, dict) else []

    form_content = content.get("multipart/form-data") or content.get("application/x-www-form-urlencoded")
    if form_content:
        schema = _resolve_ref(form_content.get("schema", {}), components)
        query = []
        for key, value in schema.get("properties", {}).items():
            value = _resolve_ref(value, components)
            if value.get("format") != "binary":
                query.append(_query_item(key, _example_from_schema(value, components), "Form field mirrored into URL params."))
        return query

    return []


def _request_body(operation: dict[str, Any], components: dict[str, Any], path: str) -> dict[str, Any] | None:
    request_body = operation.get("requestBody", {})
    content = request_body.get("content", {})

    if path == f"{API_PREFIX}/auth/login":
        return {
            "mode": "urlencoded",
            "urlencoded": [
                {"key": "username", "value": "{{username}}", "type": "text"},
                {"key": "password", "value": "{{password}}", "type": "text"},
            ],
        }

    if "application/json" in content:
        schema = content["application/json"].get("schema", {})
        example = _example_from_schema(schema, components)
        return {"mode": "raw", "raw": json.dumps(example, indent=2), "options": {"raw": {"language": "json"}}}

    if "multipart/form-data" in content:
        schema = _resolve_ref(content["multipart/form-data"].get("schema", {}), components)
        formdata = []
        for key, value in schema.get("properties", {}).items():
            value = _resolve_ref(value, components)
            item = {"key": key, "type": "file" if value.get("format") == "binary" else "text"}
            if item["type"] == "text":
                item["value"] = str(_example_from_schema(value, components))
            else:
                item["src"] = ""
            formdata.append(item)
        return {"mode": "formdata", "formdata": formdata}

    if "application/x-www-form-urlencoded" in content:
        schema = _resolve_ref(content["application/x-www-form-urlencoded"].get("schema", {}), components)
        return {
            "mode": "urlencoded",
            "urlencoded": [
                {"key": key, "value": str(_example_from_schema(value, components)), "type": "text"}
                for key, value in schema.get("properties", {}).items()
            ],
        }

    return None


def _title(value: str) -> str:
    return value.replace("-", " ").replace("_", " ").title()


def _master_folder(segment: str) -> str:
    mapping = {
        "states": "States",
        "districts": "Districts",
        "taluks": "Taluks",
        "postal-codes": "Postal Codes",
        "membership-types": "Membership",
        "membership-credit-settings": "Membership",
        "document-types": "Document Types",
        "service-types": "Service Types",
        "personal-masters": "Personal Masters",
        "deletion-reasons": "Deletion Reasons",
    }
    return mapping.get(segment, _title(segment or "General"))


def _folder_parts(tag: str, path: str) -> list[str]:
    parts = [part for part in path.removeprefix(API_PREFIX).strip("/").split("/") if part]
    top = _title(tag)

    if tag == "masters" and len(parts) > 1:
        return [top, _master_folder(parts[1])]
    if tag == "members" and len(parts) > 1:
        if parts[1] == "public-register":
            return [top, "Public Registration"]
        if parts[1] == "documents":
            return [top, "Documents"]
        if "service-optins" in parts:
            return [top, "Service Opt-ins"]
        if "membership-credit" in parts:
            return [top, "Membership Credit"]
        if "profile" in parts or "profile-changes" in parts:
            return [top, "Profiles"]
        return [top, "Members"]
    if tag == "notifications" and len(parts) > 1:
        return [top, _title(parts[1])]
    if tag == "engagements" and len(parts) > 1:
        first = parts[1]
        if first == "committee":
            return [top, "Committee"]
        return [top, _title(first)]
    if tag == "users" and len(parts) > 1:
        first = parts[1]
        if first in {"roles", "permissions", "modules"}:
            return [top, _title(first)]
        return [top, "Users"]
    if tag == "magazines" and len(parts) > 1:
        return [top, _title(parts[1])]
    if tag == "reports" and len(parts) > 1:
        return [top, _title(parts[1])]
    return [top]


def _get_folder(root: list[dict[str, Any]], parts: list[str]) -> dict[str, Any]:
    current = root
    folder: dict[str, Any] | None = None
    for part in parts:
        folder = next((item for item in current if item.get("name") == part and "request" not in item), None)
        if folder is None:
            folder = {"name": part, "item": []}
            current.append(folder)
        current = folder["item"]
    return folder or {"name": "Misc", "item": current}


def _auth_for(path: str) -> dict[str, Any]:
    public_paths = {
        f"{API_PREFIX}/auth/login",
        f"{API_PREFIX}/auth/refresh",
        f"{API_PREFIX}/auth/forgot-password",
        f"{API_PREFIX}/auth/reset-password",
        f"{API_PREFIX}/members/public-register",
    }
    if path in public_paths or path.startswith(f"{API_PREFIX}/kyc/"):
        return {"type": "noauth"}
    return {"type": "bearer", "bearer": [{"key": "token", "value": "{{access_token}}", "type": "string"}]}


def _login_tests(path: str) -> list[dict[str, str]] | None:
    if path != f"{API_PREFIX}/auth/login":
        return None
    return [
        {
            "listen": "test",
            "script": {
                "type": "text/javascript",
                "exec": [
                    "if (pm.response.code >= 200 && pm.response.code < 300) {",
                    "  const json = pm.response.json();",
                    "  pm.collectionVariables.set('access_token', json.access_token);",
                    "  pm.collectionVariables.set('refresh_token', json.refresh_token);",
                    "}",
                ],
            },
        }
    ]


def build_collection() -> dict[str, Any]:
    schema = app.openapi()
    components = schema.get("components", {}).get("schemas", {})
    folders: list[dict[str, Any]] = []

    for path, methods in sorted(schema.get("paths", {}).items()):
        for method, operation in sorted(methods.items()):
            if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue

            tag = (operation.get("tags") or ["misc"])[0]
            folder = _get_folder(folders, _folder_parts(tag, path))
            parameters = copy.deepcopy(operation.get("parameters", []))
            body_query = _body_query_params(operation, components, path)
            request = {
                "method": method.upper(),
                "header": [{"key": "Accept", "value": "application/json"}],
                "auth": _auth_for(path),
                "url": _url(path, parameters, body_query),
            }

            body = _request_body(operation, components, path)
            if body:
                request["body"] = body
                if body["mode"] == "raw":
                    request["header"].append({"key": "Content-Type", "value": "application/json"})

            item = {
                "name": operation.get("summary") or f"{method.upper()} {path}",
                "request": request,
                "response": [],
            }
            events = _login_tests(path)
            if events:
                item["event"] = events
            folder["item"].append(item)

    return {
        "info": {
            "name": "HMS MMA API",
            "_postman_id": "hms-mma-api",
            "description": "Generated from the FastAPI OpenAPI schema.",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "variable": [
            {"key": "serverUrl", "value": "http://localhost:8000"},
            {"key": "baseUrl", "value": "http://localhost:8000/api/v1"},
            {"key": "username", "value": "admin"},
            {"key": "password", "value": ""},
            {"key": "access_token", "value": ""},
            {"key": "refresh_token", "value": ""},
        ],
        "item": sorted(folders, key=lambda item: item["name"]),
    }


def main() -> None:
    collection = build_collection()
    OUTPUT.write_text(json.dumps(collection, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    print(f"Folders: {len(collection['item'])}")
    print(f"Requests: {_count_requests(collection['item'])}")


def _count_requests(items: list[dict[str, Any]]) -> int:
    total = 0
    for item in items:
        if "request" in item:
            total += 1
        else:
            total += _count_requests(item.get("item", []))
    return total


if __name__ == "__main__":
    main()
