from __future__ import annotations

import os
import subprocess
import time
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
        "install",
        "-r",
        str(REQUIREMENTS_PATH),
    ])


def main() -> None:
    python_path = ensure_venv()
    install_dependencies(python_path)

    print("后端服务启动中 ...")
    process = subprocess.Popen([str(python_path), str(APP_PATH)], cwd=ROOT)
    time.sleep(0.8)
    print(f"正在打开网页：{URL}")
    webbrowser.open(URL)
    try:
        process.wait()
    except KeyboardInterrupt:
        process.terminate()
        process.wait()


if __name__ == "__main__":
    main()
