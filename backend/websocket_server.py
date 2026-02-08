from __future__ import annotations

import asyncio
import inspect
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional
from urllib.parse import urlparse

import websockets

SkeletonHandler = Callable[[Dict[str, Any]], Optional[Awaitable[None]]]


@dataclass
class IOSWebSocketConfig:
    host: str
    port: int
    path: str = "/skeleton"
    scheme: str = "ws"
    reconnect_delay_sec: float = 1.0


def _normalize_ws_scheme(raw_scheme: str) -> str:
    scheme = raw_scheme.strip().lower()
    if scheme in {"http", "ws"}:
        return "ws"
    if scheme in {"https", "wss"}:
        return "wss"
    return "ws"


def _normalize_ws_path(raw_path: str) -> str:
    path = (raw_path or "/skeleton").strip()
    if not path:
        return "/skeleton"
    if not path.startswith("/"):
        return f"/{path}"
    return path


def _parse_ws_target(config: IOSWebSocketConfig) -> tuple[str, str, int, str]:
    scheme = _normalize_ws_scheme(config.scheme)
    host = config.host.strip()
    port = int(config.port)
    path = _normalize_ws_path(config.path)

    if "://" not in host:
        return scheme, host, port, path

    parsed = urlparse(host)
    if parsed.scheme:
        scheme = _normalize_ws_scheme(parsed.scheme)
    if parsed.hostname:
        host = parsed.hostname
    if parsed.port is not None:
        port = parsed.port
    parsed_path = parsed.path.strip()
    if parsed_path and parsed_path != "/":
        path = _normalize_ws_path(parsed_path)
    return scheme, host, port, path


def build_websocket_uri(config: IOSWebSocketConfig) -> str:
    scheme, host, port, path = _parse_ws_target(config)
    host_for_uri = host
    if ":" in host_for_uri and not host_for_uri.startswith("["):
        host_for_uri = f"[{host_for_uri}]"
    return f"{scheme}://{host_for_uri}:{port}{path}"


def _decode_payload(message: Any) -> Dict[str, Any]:
    if isinstance(message, bytes):
        message = message.decode("utf-8")

    if not isinstance(message, str):
        raise ValueError("Incoming message must be text JSON")

    payload = json.loads(message)
    if not isinstance(payload, dict):
        raise ValueError("Incoming skeleton payload must be a JSON object")
    return payload


async def _dispatch(handler: SkeletonHandler, payload: Dict[str, Any]) -> None:
    result = handler(payload)
    if inspect.isawaitable(result):
        await result


async def run_skeleton_ws_server(
    config: IOSWebSocketConfig,
    handler: SkeletonHandler,
) -> None:
    _scheme, listen_host, listen_port, expected_path = _parse_ws_target(config)

    async def on_connection(websocket, path=None):
        request_path = path if path is not None else getattr(websocket, "path", "")
        if request_path != expected_path:
            await websocket.close(code=1008, reason="Unexpected WebSocket path")
            return

        async for raw_message in websocket:
            payload = _decode_payload(raw_message)
            await _dispatch(handler, payload)

    async with websockets.serve(
        on_connection,
        listen_host,
        listen_port,
        max_queue=1,
    ):
        print(
            f"[WebSocket] Listening on ws://{listen_host}:{listen_port}{expected_path}"
        )
        await asyncio.Future()


async def consume_remote_skeleton_stream(
    config: IOSWebSocketConfig,
    handler: SkeletonHandler,
) -> None:
    uri = build_websocket_uri(config)
    while True:
        try:
            async with websockets.connect(
                uri,
                ping_interval=20,
                ping_timeout=20,
                max_queue=1,
            ) as socket:
                print(f"[WebSocket] Connected to {uri}")
                async for raw_message in socket:
                    payload = _decode_payload(raw_message)
                    await _dispatch(handler, payload)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            error_message = str(error)
            lowered = error_message.lower()
            if "https" in lowered or "invalid http" in lowered or "status" in lowered:
                print(
                    "[WebSocket] Connection rejected. The endpoint appears to be HTTP/HTTPS "
                    "instead of a WebSocket stream. Use ws:// or wss://."
                )
            print(
                f"[WebSocket] Connection error: {error_message}. "
                f"Reconnecting in {config.reconnect_delay_sec:.1f}s"
            )
            await asyncio.sleep(config.reconnect_delay_sec)
