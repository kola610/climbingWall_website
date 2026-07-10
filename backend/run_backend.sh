#!/bin/zsh
# Starts the climbing-wall backend (Flask + Phidget stream).
# Run this from Terminal.app — Terminal needs the macOS "Input Monitoring"
# permission for the Phidget bridges (HID devices) to attach.
cd "$(dirname "$0")"
exec ./venv/bin/python app.py
