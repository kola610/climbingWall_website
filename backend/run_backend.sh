#!/bin/zsh
# Starts the climbing-wall backend (Flask + Phidget stream).
# Requires the Phidgets driver extension to be enabled once per machine
# (System Settings -> Privacy & Security -> allow the Phidgets driver);
# without it every channel open fails with "device is in use".
cd "$(dirname "$0")"
exec ./venv/bin/python app.py
