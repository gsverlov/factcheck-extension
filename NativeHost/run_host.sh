#!/bin/sh
# Launcher Chrome runs on macOS and Linux (run_host.bat is the Windows one).
# Uses the Python on PATH; point this at a virtualenv's python if you use one.
cd "$(dirname "$0")" || exit 1
exec python3 host.py
