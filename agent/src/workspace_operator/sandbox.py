"""Run short Python / JavaScript snippets inside a fresh `modal.Sandbox`.

The Workspace Operator already runs inside Modal (see `app.py`), so the
cleanest way to give its `execute_code` tool real isolation is to spawn
a child sandbox from within the running app. This module hides the
Modal details and exposes a single async entrypoint `run_sandboxed()`
that returns a structured `SandboxResult` — never raising — so the tool
handler can forward the result straight to the LLM and to the audit
endpoint.

Safety rails enforced here (the caller does NOT get to override them):

- `SANDBOX_MAX_TIMEOUT`: hard wall-clock cap on execution.
- `SANDBOX_MAX_STDOUT` / `SANDBOX_MAX_STDERR`: byte caps on captured
  streams; anything larger is truncated and `truncated=True` is
  signaled back to the caller so the UI can warn.

The sandbox images (one Python, one JS) are built once per container
as module-level module objects — Modal will cache them across calls.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

import modal

log = logging.getLogger(__name__)

# ─── Hard caps ─────────────────────────────────────────────────────────────────

SANDBOX_MAX_TIMEOUT: float = 30.0
SANDBOX_MAX_STDOUT: int = 64_000
SANDBOX_MAX_STDERR: int = 16_000


# ─── Result type ───────────────────────────────────────────────────────────────


@dataclass
class SandboxResult:
    """Outcome of a single sandboxed execution.

    `error` is non-None only when something went wrong at the sandbox
    layer itself (timeout, Modal-level error, bad language). A snippet
    that ran to completion but exited with a non-zero status reports
    `exit_code != 0` and a null `error`.
    """

    stdout: str
    stderr: str
    exit_code: int
    elapsed_ms: int
    truncated: bool
    error: str | None


# ─── Cached sandbox images ─────────────────────────────────────────────────────

_python_image: modal.Image | None = None
_js_image: modal.Image | None = None


def _sandbox_image_python() -> modal.Image:
    """Debian-slim image with Python 3.12 for running Python snippets."""
    global _python_image
    if _python_image is None:
        _python_image = modal.Image.debian_slim(python_version="3.12")
    return _python_image


def _sandbox_image_js() -> modal.Image:
    """Debian-slim image with Node.js 20 for running JavaScript snippets."""
    global _js_image
    if _js_image is None:
        _js_image = (
            modal.Image.debian_slim()
            .apt_install("curl", "ca-certificates")
            .run_commands(
                "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
                "apt-get install -y nodejs",
            )
        )
    return _js_image


# ─── App resolution ────────────────────────────────────────────────────────────


def _resolve_app() -> modal.App | None:
    """Return the running Modal `App` if one is importable, else None.

    `modal.Sandbox.create()` needs to know which app the child sandbox
    belongs to. The canonical source is `workspace_operator.app.app`,
    but importing it eagerly from a module that `app.py` itself reaches
    (transitively through `operator.py` / `tools/*`) would create a
    circular import. We try the import lazily and fall back to `None`
    so Modal can detect the surrounding context on its own.
    """
    try:
        from workspace_operator.app import app as _app  # noqa: PLC0415

        return _app
    except Exception:  # noqa: BLE001 — circular import or missing attribute
        return None


# ─── Helpers ───────────────────────────────────────────────────────────────────


def _truncate(data: bytes | str, cap: int) -> tuple[str, bool]:
    """Decode + clip a stream to `cap` bytes, returning (text, was_truncated)."""
    if isinstance(data, bytes):
        raw = data
    else:
        raw = data.encode("utf-8", errors="replace")
    if len(raw) <= cap:
        return raw.decode("utf-8", errors="replace"), False
    clipped = raw[:cap].decode("utf-8", errors="replace")
    return clipped, True


def _read_stream(stream: object) -> str:
    """Read a Modal sandbox stream to exhaustion as a string.

    Modal's sandbox `stdout` / `stderr` accessors are file-like; calling
    `.read()` with no args returns everything written so far. We defend
    against both bytes and str returns and against objects that already
    surface text without a read method.
    """
    if stream is None:
        return ""
    read = getattr(stream, "read", None)
    if read is None:
        return str(stream)
    try:
        value = read()
    except Exception as exc:  # noqa: BLE001
        log.warning("sandbox stream read failed: %s", exc)
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value or "")


def _build_sandbox(*, language: str, code: str, timeout_int: int) -> modal.Sandbox:
    """Create a fresh `modal.Sandbox` for `code` in `language`."""
    app = _resolve_app()
    if language == "python":
        image = _sandbox_image_python()
        cmd = ("python", "-c", code)
    elif language == "javascript":
        image = _sandbox_image_js()
        cmd = ("node", "-e", code)
    else:
        raise ValueError(f"unsupported language: {language}")

    kwargs: dict[str, object] = {"image": image, "timeout": timeout_int}
    if app is not None:
        kwargs["app"] = app
    return modal.Sandbox.create(*cmd, **kwargs)


def _run_sandboxed_sync(
    *, language: str, code: str, timeout_seconds: float
) -> SandboxResult:
    """Blocking implementation — invoked off the event loop by `run_sandboxed`."""
    capped_timeout = max(0.1, min(float(timeout_seconds), SANDBOX_MAX_TIMEOUT))
    timeout_int = max(1, int(capped_timeout))

    start = time.perf_counter()
    sb: modal.Sandbox | None = None
    try:
        sb = _build_sandbox(language=language, code=code, timeout_int=timeout_int)
        sb.wait()
        stdout_raw = _read_stream(getattr(sb, "stdout", None))
        stderr_raw = _read_stream(getattr(sb, "stderr", None))
        exit_code_raw = getattr(sb, "returncode", None)
        exit_code = (
            int(exit_code_raw) if isinstance(exit_code_raw, int) else -1
        )
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        stdout, stdout_trunc = _truncate(stdout_raw, SANDBOX_MAX_STDOUT)
        stderr, stderr_trunc = _truncate(stderr_raw, SANDBOX_MAX_STDERR)
        return SandboxResult(
            stdout=stdout,
            stderr=stderr,
            exit_code=exit_code,
            elapsed_ms=elapsed_ms,
            truncated=stdout_trunc or stderr_trunc,
            error=None,
        )
    except Exception as exc:  # noqa: BLE001 — we normalize everything
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        # Detect Modal's timeout flavor without hard-coding a specific
        # import path (the exception module has moved historically).
        name = type(exc).__name__
        if "Timeout" in name:
            error = "timeout"
        else:
            error = f"sandbox_error: {exc}"
        return SandboxResult(
            stdout="",
            stderr="",
            exit_code=-1,
            elapsed_ms=elapsed_ms,
            truncated=False,
            error=error,
        )
    finally:
        if sb is not None:
            try:
                sb.terminate()
            except Exception:  # noqa: BLE001 — best-effort cleanup
                pass


# ─── Public async entrypoint ───────────────────────────────────────────────────


async def run_sandboxed(
    *,
    language: str,
    code: str,
    timeout_seconds: float,
) -> SandboxResult:
    """Run `code` in a fresh Modal sandbox and capture the result.

    `language` must be `"python"` or `"javascript"`. `timeout_seconds`
    is capped at `SANDBOX_MAX_TIMEOUT`. The function is safe to call
    from an async tool handler: the blocking Modal calls are pushed to
    a worker thread so the event loop stays responsive for other tools
    running in parallel.
    """
    if language not in {"python", "javascript"}:
        return SandboxResult(
            stdout="",
            stderr="",
            exit_code=-1,
            elapsed_ms=0,
            truncated=False,
            error=f"sandbox_error: unsupported language: {language}",
        )
    return await asyncio.to_thread(
        _run_sandboxed_sync,
        language=language,
        code=code,
        timeout_seconds=timeout_seconds,
    )
