from __future__ import annotations

import os
import subprocess
import time
import urllib.error
import urllib.request
import venv
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VENV_DIR = ROOT / ".venv"
APP_PATH = ROOT / "app.py"
REQUIREMENTS_PATH = ROOT / "requirements.txt"
URL = "http://127.0.0.1:8765/"


def venv_python() -> Path:
    if os.name == "nt":
        candidates = (
            VENV_DIR / "Scripts" / "python.exe",
            VENV_DIR / "Scripts" / "python3.exe",
        )
        return next((path for path in candidates if path.exists()), candidates[0])
    return VENV_DIR / "bin" / "python"


def ensure_venv() -> Path:
    python_path = venv_python()
    config_path = VENV_DIR / "pyvenv.cfg"
    if not python_path.exists() or not config_path.exists():
        print("正在创建本地 Python 虚拟环境 .venv ...")
        venv.EnvBuilder(with_pip=True).create(VENV_DIR)
        python_path = venv_python()
    if not python_path.exists():
        raise RuntimeError(f"无法找到虚拟环境解释器：{python_path}")
    return python_path


def install_dependencies(python_path: Path) -> None:
    if not REQUIREMENTS_PATH.exists():
        return
    print("正在安装/检查后端依赖 ...")
    subprocess.check_call([
        str(python_path),
        "-m",
        "pip",
        "--disable-pip-version-check",
        "install",
        "-r",
        str(REQUIREMENTS_PATH),
    ])


def wait_for_server(process: subprocess.Popen[bytes], timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("后端服务启动失败，请查看上方错误信息。")
        try:
            with urllib.request.urlopen(URL, timeout=0.5):
                return
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            time.sleep(0.25)
    raise RuntimeError(f"后端服务未能在 {timeout:.0f} 秒内就绪：{last_error}")


def main() -> None:
    python_path = ensure_venv()
    install_dependencies(python_path)

    print("后端服务启动中 ...")
    process = subprocess.Popen([str(python_path), str(APP_PATH)], cwd=ROOT)
    try:
        wait_for_server(process)
        print(f"正在打开网页：{URL}")
        webbrowser.open(URL)
        process.wait()
    except (KeyboardInterrupt, RuntimeError):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        raise


if __name__ == "__main__":
    main()
